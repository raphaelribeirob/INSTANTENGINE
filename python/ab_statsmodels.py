#!/usr/bin/env python3
"""Statistical QA for predeclared randomized RIVERENGINE A/B experiments.

Never auto-ship from p-values. Inputs must represent unique eligible mature users.
Sequential monitoring and many experiment metrics require alpha-spending/FDR beyond here.
"""
import argparse
import json
import math
from pathlib import Path
from scipy.stats import chisquare
from statsmodels.stats.proportion import confint_proportions_2indep, proportions_ztest, proportion_confint


def analyze(report):
    """report = {experiment, window, randomized, arms:{control:{n,successes},test:{...}}, allocation:{control:0.5,test:0.5}, minPerArm:100}."""
    try:
        control, test = report["arms"]["control"], report["arms"]["test"]
        n0, n1 = control["n"], test["n"]
        k0, k1 = control["successes"], test["successes"]
    except (KeyError, TypeError) as exc:
        raise ValueError("Missing control and test denominators") from exc
    for n, k in ((n0, k0), (n1, k1)):
        if type(n) is not int or type(k) is not int or n <= 0 or not 0 <= k <= n:
            raise ValueError("Invalid unique mature cohort counts")
    if report.get("randomized") is not True:
        raise ValueError("Causal A/B inference requires randomized allocation")
    allocation = report.get("allocation", {"control": .5, "test": .5})
    p0, p1 = allocation.get("control"), allocation.get("test")
    if not all(isinstance(p, (float, int)) and not isinstance(p, bool) and 0 < p < 1 for p in (p0, p1)) or abs(p0 + p1 - 1) > 1e-10:
        raise ValueError("Invalid preregistered allocation")
    if report.get("window") not in ("D1", "D7", "D30"):
        raise ValueError("Use mature D1, D7, or D30 cohorts")
    min_arm = report.get("minPerArm", 100)
    if type(min_arm) is not int or not 20 <= min_arm <= 1_000_000:
        raise ValueError("Invalid minimum sample threshold")
    total = n0 + n1
    srm_p = float(chisquare([n0, n1], f_exp=[total*p0, total*p1]).pvalue)
    rate0, rate1 = k0/n0, k1/n1
    diff = rate1-rate0
    # Statsmodels' Newcombe 95% CI for difference p_test - p_control.
    ci = confint_proportions_2indep(k1, n1, k0, n0, compare="diff", method="newcomb", alpha=.05)
    p_value = float(proportions_ztest([k1, k0], [n1, n0], alternative="two-sided")[1])
    guard = "sample_ratio_mismatch" if srm_p < .001 else "insufficient_mature_samples" if min(n0,n1) < min_arm else "manual_review_required"
    return {
        "experiment": report.get("experiment", "unnamed"), "window":report["window"],
        "status":guard,"decision":"never_auto_ship", "matured_unique": {"control":n0,"test":n1},
        "conversion": {"control":round(rate0,6),"test":round(rate1,6)},
        "difference_pp":round(diff*100,4), "relative_lift_percent":round((diff/rate0*100),4) if rate0 else None,
        "ci95_difference_pp":[round(float(ci[0])*100,4),round(float(ci[1])*100,4)],
        "p_value_nominal":round(p_value,8) if math.isfinite(p_value) else None,
        "srm_p_value":round(srm_p,9), "srm_flagged":srm_p<.001,
        "disclaimer":"Nominal fixed-horizon test only. No causal decision for observational data, peeking, multiple comparisons or unverified attribution."
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--input", required=True);ap.add_argument("--output",required=True)
    a=ap.parse_args()
    src=json.loads(Path(a.input).read_text(encoding="utf-8"))
    data=src if isinstance(src,list) else [src]
    result=[analyze(row) for row in data]
    Path(a.output).write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"evaluated":len(result),"results":result}))
if __name__=='__main__':main()
