import csv
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from churn_train_offline import load, train


class ChurnTrainingTest(unittest.TestCase):
    def test_temporal_train_produces_unapproved_artifact(self):
        rng = np.random.default_rng(42)
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'training.csv'
            fieldnames = ['day','daysSinceOpen','activeDays7','activeDaysPrev7','completed7','failed7','crashes7','opens7','returnedTomorrow']
            with p.open('w',newline='') as f:
                writer=csv.DictWriter(f,fieldnames=fieldnames)
                writer.writeheader()
                for day in range(36):
                    for i in range(55):
                        active=int(rng.integers(0,8))
                        completed=active*2
                        returned=int(rng.random() < 0.12+0.1*active)
                        writer.writerow(dict(day=(date(2026,8,1)+timedelta(days=day)).isoformat(),daysSinceOpen=max(0,7-active),
                            activeDays7=active,activeDaysPrev7=int(rng.integers(0,8)),completed7=completed,failed7=0,crashes7=0,opens7=active+1,returnedTomorrow=returned))
            artifact=train(p,'test-model-v1')
            self.assertEqual(artifact['schema'],'river_churn_v1')
            self.assertFalse(artifact['approved'])
            self.assertGreaterEqual(artifact['validation']['testSize'],200)
            self.assertEqual(len(artifact['weights']),7)
    def test_disallows_personal_identifier_columns(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'bad.csv'
            p.write_text('day,userId,returnedTomorrow\n2026-08-01,123,1\n')
            with self.assertRaises(ValueError):load(p)

if __name__=='__main__':unittest.main()
