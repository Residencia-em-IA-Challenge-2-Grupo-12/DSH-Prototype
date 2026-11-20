import {authorizeSyntheticCalendar} from '../../src/foundation/synthetic-calendar-auth.mjs';

// The test's synthetic bearer remains in its trusted controller, never in the
// agent container or the evidence log.
export const syntheticToken=(run,student,redirectUri)=>authorizeSyntheticCalendar({run,student,redirectUri});
