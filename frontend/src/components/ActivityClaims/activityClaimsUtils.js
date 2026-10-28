import api from '../../api/client';

/* Shared by the student's "Add missing activity" form and the coordinator's
   My Club → Student Activity tab. Categories mirror the 8 event categories. */
export const CATEGORY_OPTIONS = [
  { value: 'sports',      label: 'Sports'      },
  { value: 'cultural',    label: 'Cultural'    },
  { value: 'annual-fest', label: 'Annual Fest' },
  { value: 'community',   label: 'Community'   },
  { value: 'leadership',  label: 'Leadership'  },
  { value: 'tech',        label: 'Tech'        },
  { value: 'health',      label: 'Health'      },
  { value: 'general',     label: 'General'     },
];
export const RESULT_OPTIONS = [
  { value: 'participation', label: 'Participation' },
  { value: 'runner_up',     label: 'Runner-up'     },
  { value: 'winner',        label: 'Winner'        },
];
export const RESULT_LABEL = Object.fromEntries(RESULT_OPTIONS.map(o => [o.value, o.label]));

/* Proofs are private: each view asks the server for a fresh link that expires
   after an hour. The tab is opened first (inside the click) so pop-up blockers
   allow it, then pointed at the link. */
export async function openProof(claimId) {
  const tab = window.open('', '_blank');
  try {
    const { url } = await api.get(`/student-activity/${claimId}/proof`);
    const abs = new URL(url, window.location.origin).href;
    if (tab) { tab.opener = null; tab.location.href = abs; } else { window.location.href = abs; }
  } catch (err) {
    if (tab) tab.close();
    window.alert(err.message || 'Could not open the proof.');
  }
}
