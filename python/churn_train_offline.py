"""RIVERENGINE v3.0: Offline, temporal, opt-in churn calibration candidate.

CSV columns EXACTLY: day,daysSinceOpen,activeDays7,activeDaysPrev7,completed7,
failed7,crashes7,opens7,returnedTomorrow. NO identifiers, IPs or device metadata.
Training: early days, calibrate: later days, evaluate on latest held-out days.
An output artifact is never automatically approved for production.
"""
import csv
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from scipy.stats import rankdata

FEATURES = ('daysSinceOpen', 'activeDays7', 'activeDaysPrev7', 'completed7', 'failed7', 'crashes7', 'opens7')
FIELDS = {'day', 'returnedTomorrow', *FEATURES}
SCALES = np.array([7., 7., 7., 10., 10., 3., 14.])


def load(path):
    with open(path, newline='', encoding='utf-8') as handle:
        reader = csv.DictReader(handle)
        if set(reader.fieldnames or []) != FIELDS:
            raise ValueError('CSV schema must contain only whitelisted numeric features, UTC day and outcome')
        rows = list(reader)
    if len(rows) < 1000:
        raise ValueError('Insufficient labels to train: require >=1000 consented matured rows')
    days, x, y = [], [], []
    for row in rows:
        day = date.fromisoformat(row['day'])
        if day >= date.today():
            raise ValueError('Unmatured next-day labels are prohibited')
        nums = np.array([float(row[k]) for k in FEATURES])
        if not np.all(np.isfinite(nums)) or np.any(nums < 0) or np.any(nums != np.floor(nums)):
            raise ValueError('Invalid engagement features')
        if nums[1] > 7 or nums[2] > 7 or nums[0] > 365 or np.any(nums[3:] > 100000):
            raise ValueError('Engagement feature bounds exceeded')
        if row['returnedTomorrow'] not in ('0','1'):
            raise ValueError('Outcome must be 0 or 1')
        days.append(day)
        x.append(np.minimum(nums / SCALES, 1))
        y.append(int(row['returnedTomorrow']))
    return np.array(days), np.array(x), np.array(y)


def fit_logit(x, y):
    if len(np.unique(y)) < 2:
        raise ValueError('Both classes required')
    xx = np.column_stack((np.ones(len(x)), x))
    def objective(w):
        logits = xx @ w
        loss = np.logaddexp(0, logits).sum() - (y * logits).sum() + 0.5 * np.sum(w[1:]**2)
        gradient = xx.T @ (expit(logits) - y)
        gradient[1:] += w[1:]
        return loss, gradient
    result = minimize(objective, np.zeros(xx.shape[1]), jac=True, method='L-BFGS-B')
    if not result.success:
        raise RuntimeError('Convergence failure')
    return result.x


def auc(y, probabilities):
    positives = np.sum(y == 1)
    negatives = np.sum(y == 0)
    if min(positives, negatives) == 0:
        return 0.
    ranks = rankdata(probabilities)
    return float((np.sum(ranks[y == 1]) - positives*(positives+1)/2) / (positives*negatives))


def ece(y, probabilities):
    bins = np.minimum((probabilities*10).astype(int), 9)
    return float(sum(np.mean(bins == i) * abs(float(np.mean(y[bins == i]) - np.mean(probabilities[bins == i])))
                     for i in range(10) if np.any(bins == i)))


def train(path, version):
    days, x, y = load(path)
    unique = np.unique(days)
    if len(unique) < 20:
        raise ValueError('At least 20 distinct UTC days required for temporal validation')
    t1 = unique[int(len(unique)*0.70)]
    t2 = unique[int(len(unique)*0.85)]
    early, calibrate, final = days < t1, (days >= t1) & (days < t2), days >= t2
    if min(np.sum(early), np.sum(calibrate), np.sum(final)) < 200:
        raise ValueError('Insufficient samples in train/calibration/held-out windows')
    if min(np.sum(y[final] == 1), np.sum(y[final] == 0)) < 30:
        raise ValueError('Held-out target must contain >=30 each class')
    w = fit_logit(x[early], y[early])
    raw_calibration = expit(w[0] + x[calibrate] @ w[1:])
    # Platt calibration on middle days, never using the held-out test labels.
    z = np.log(np.clip(raw_calibration, 1e-6, 1-1e-6) / np.clip(1-raw_calibration, 1e-6, 1))
    w_cal = fit_logit(z.reshape(-1, 1), y[calibrate])
    intercept = float(w_cal[0] + w_cal[1]*w[0])
    weights = (w_cal[1]*w[1:]).tolist()
    predictions = expit(intercept + x[final] @ np.array(weights))
    base = float(np.mean(y[early]))
    validation = {
        'testSize': int(np.sum(final)), 'returned': int(np.sum(y[final])),
        'didNotReturn': int(np.sum(final) - np.sum(y[final])),
        'auc': round(auc(y[final], predictions), 6),
        'brier': round(float(np.mean((predictions-y[final])**2)), 6),
        'baselineBrier': round(float(np.mean((base-y[final])**2)), 6),
        'calibrationError': round(ece(y[final], predictions), 6),
    }
    passed = validation['auc'] >= 0.6 and validation['brier'] <= validation['baselineBrier'] and validation['calibrationError'] <= 0.1
    return {
        'schema':'river_churn_v1', 'version': version, 'status': 'validated' if passed else 'rejected',
        'approved': False, 'weights': [round(float(v), 9) for v in weights], 'intercept': round(intercept, 9),
        'validation': validation,
        'note': 'Operator must independently review leakage, cohort bias, consent and monitoring before setting approved=true. Not approved automatically.'
    }


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Usage: python python/churn_train_offline.py CONSENTED_MATURED.csv VERSION OUTPUT.json')
    input_path, version, output_path = sys.argv[1:]
    if not (2 <= len(version) <= 64 and all(c.isalnum() or c in '._-' for c in version)):
        raise SystemExit('Invalid version')
    result = train(input_path, version)
    Path(output_path).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status':result['status'], 'approved':False, 'validation':result['validation']}))
