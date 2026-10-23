#!/usr/bin/env python3
"""MABWiser offline, privacy-preserving retention-policy trainer.

Install MABWiser in the dedicated Python analytics environment. NOT trained/online
unless exposed outcomes are randomized, matured, consented, and auditable.
Model outputs are unsigned and disabled until server-side operator signing.
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEGMENTS = [f"{persona}_{daypart}" for persona in ("new", "returning", "streak")
            for daypart in ("morning", "afternoon", "evening")]

def features(segment):
    if segment not in SEGMENTS:
        raise ValueError("Unknown anonymized context segment")
    return [int(item == segment) for item in SEGMENTS]

def train(dataset, *, as_of):
    try:
        from mabwiser.mab import MAB, LearningPolicy
    except ImportError as exc:
        raise RuntimeError("MABWiser is not installed: pip install mabwiser") from exc
    if dataset.get("randomized") is not True:
        raise ValueError("Randomized assignment with logged propensities is required")
    scope = dataset.get("scope") or {}
    if scope.get("environment") not in ("test", "staging", "prod") or not all(scope.get(k) for k in ("tenant", "app")):
        raise ValueError("Invalid scope")
    arms = dataset.get("arms")
    if not isinstance(arms, list) or len(arms) < 2 or len(arms) > 20 or len(set(arms)) != len(arms):
        raise ValueError("Invalid arms")
    observations = dataset.get("observations")
    if not isinstance(observations, list):
        raise ValueError("Expected observations array")
    decisions, rewards, contexts, counts = [], [], [], {arm: 0 for arm in arms}
    for record in observations:
        if not isinstance(record, dict) or record.get("consented") is not True or record.get("matured") is not True or record.get("exposed") is not True:
            continue
        if record.get("arm") not in counts or record.get("segment") not in SEGMENTS:
            raise ValueError("Invalid arm or segment")
        if record.get("reward") not in (0, 1) or type(record.get("reward")) is not int:
            raise ValueError("Reward must be verified 0/1")
        propensity = record.get("propensity")
        if not isinstance(propensity, (float, int)) or isinstance(propensity, bool) or not (0.1 <= propensity <= 1.0):
            raise ValueError("Invalid logged assignment propensity")
        decisions.append(record["arm"])
        rewards.append(record["reward"])
        contexts.append(features(record["segment"]))
        counts[record["arm"]] += 1
    if len(decisions) < 100 or min(counts.values()) < 25:
        raise ValueError("Insufficient mature randomized observations per arm")
    model = MAB(arms=arms, learning_policy=LearningPolicy.LinUCB(alpha=0.5), seed=23, n_jobs=1)
    model.fit(decisions, rewards, contexts)
    suggestions = {segment: model.predict([features(segment)])[0] for segment in SEGMENTS}
    # Only these coarse behavioral buckets are used: no demographic or sensitive dimensions.
    stamp = as_of.astimezone(timezone.utc).replace(microsecond=0)
    return dict(schema=1, model="mabwiser", tenant=scope["tenant"], app=scope["app"],
                environment=scope["environment"], arms=arms, sampleCount=len(decisions),
                createdAt=stamp.isoformat().replace("+00:00", "Z"),
                expiresAt=(stamp + timedelta(days=7)).isoformat().replace("+00:00", "Z"),
                decisions=suggestions,
                limitations="Offline advisory only; randomized mature reward labels; requires independent A/B holdout")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--as-of", default=None)
    args = p.parse_args()
    moment = datetime.fromisoformat(args.as_of.replace("Z", "+00:00")) if args.as_of else datetime.now(timezone.utc)
    data = json.loads(Path(args.input).read_text(encoding="utf-8"))
    try:
        policy = train(data, as_of=moment)
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    Path(args.output).write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "trained_unsigned_disabled", "sampleCount": policy["sampleCount"], "output": args.output}))
    return 0

if __name__ == "__main__":
    sys.exit(main())
