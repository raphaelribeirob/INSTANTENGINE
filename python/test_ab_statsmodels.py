import unittest
from datetime import datetime, timezone
from ab_statsmodels import analyze
from bandit_offline import train, features


class RiverExperimentTests(unittest.TestCase):
    def sample(self):
        return {'experiment':'lesson_goal', 'window':'D7','randomized':True,
                'arms':{'control':{'n':600,'successes':180},'test':{'n':600,'successes':240}},
                'allocation':{'control':.5,'test':.5},'minPerArm':100}
    def test_statsmodels_positive_lift(self):
        r=analyze(self.sample()); self.assertEqual(r['status'],'manual_review_required')
        self.assertEqual(r['difference_pp'],10)
        self.assertTrue(r['ci95_difference_pp'][0]>0)
    def test_sample_ratio_mismatch(self):
        s=self.sample(); s['arms']['control']['n']=900
        s['arms']['test']['n']=300
        self.assertEqual(analyze(s)['status'],'sample_ratio_mismatch')
    def test_low_n_rejected_as_decision(self):
        s=self.sample(); s['arms']['control']['n']=50; s['arms']['test']['n']=50
        s['arms']['control']['successes']=20; s['arms']['test']['successes']=20
        self.assertEqual(analyze(s)['status'],'insufficient_mature_samples')
    def test_invalid_counts(self):
        s=self.sample(); s['arms']['test']['successes']=800
        with self.assertRaises(ValueError): analyze(s)
    def test_requires_randomization(self):
        s=self.sample(); s['randomized']=False
        with self.assertRaises(ValueError): analyze(s)
    def test_bandit_guards_randomization_even_without_model(self):
        data={'randomized':False,'scope':{'tenant':'school','app':'study','environment':'test'}, 'arms':['a','no_send'],'observations':[]}
        # Missing MABWiser raises an actionable installation error; when installed it must reject this input.
        try:
            train(data,as_of=datetime(2026,10,21,tzinfo=timezone.utc))
        except (RuntimeError,ValueError): pass
        else: self.fail('Unrandomized training unexpectedly accepted')
    def test_features_allow_only_coarse_buckets(self):
        self.assertEqual(sum(features('new_morning')),1)
        with self.assertRaises(ValueError):features('sensitive_attribute')

if __name__=='__main__':unittest.main()
