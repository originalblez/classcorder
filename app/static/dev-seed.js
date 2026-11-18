// Dummy data for trying the app: opened with ?test&seed, it replaces the test folder's
// data (the browser's private storage, never a real folder) with made-up classes,
// pupils and notes from the last three weeks. All names are invented.

import { schoolYearFor } from './store.js';

const CLASSES = {
  '7EF Dance': ['Ruby Ashworth', 'Isla Bennett', 'Maddie Clarke', 'Elliana Dunn', 'Annabel Ford', 'Amelia Grant',
    'Mia Hughes', 'Neve Irwin', 'Paige Jordan', 'Dolcie Kemp', 'Jude Lowe', 'Jaden Marsh', 'Dolly Nash', 'Ame Osei'],
  '9B Drama': ['Theo Parker', 'Freya Quinn', 'Leo Russell', 'Ava Shah', 'Oscar Turner', 'Lily Underwood',
    'Noah Vaughan', 'Grace Walsh', 'Harry Young', 'Evie Zeller'],
  '10C GCSE Dance': ['Sophie Abbott', 'Chloe Barnes', 'Ellie Cooper', 'Hannah Doyle', 'Megan Ellis', 'Zara Finch'],
};

// [days ago, time, pupils (first names; several = a group note), text]
const NOTES = [
  [0, '10:15', ['Ruby'], 'Ruby has a really clear motif, the hands wrapping round her face, repeated well. Good canon and counterpoint with her partner. The backbend comes back but you would not notice it as a motif yet, so she needs to develop it. They are dancing too close together and the floor slide looks like it is on the wrong leg. More contact and levels.'],
  [0, '10:22', ['Isla'], 'Lovely movement material, piece is in a good place. No clear motif yet, the fist bang on the floor and the wipe could be it. Needs more contact and make it more dynamic. Dancing in a tiny area of a big space.'],
  [0, '10:30', ['Maddie'], 'Musicality and timing excellent. All required actions in. Walks and floor patterns lovely, travelling section uses the space really well. Repeats things in the moment but no motif through the whole piece. Small area before the travelling section. More contact.'],
  [0, '10:41', ['Jude', 'Dolly', 'Ame'], 'Really strong start, good timing and a nice formation, clearly knew the movement. They keep talking to each other over the music while the dance is going. Careful moving into the new formations, nearly bumped into each other.'],
  [0, '10:48', ['Jaden', 'Neve', 'Paige'], 'Good formation at the start and used the space well. The jump to swap lines was a really creative idea. Need to use rehearsal time better, not everyone was sure what they were doing. No ending position.'],
  [0, '10:55', ['Elliana'], 'Sustained section is much better since last week, the slow reach to the floor really stands out. Gestures still blur together at the end. Use stillness before the final pose.'],
  [0, '11:02', ['Annabel'], 'Broke the unison today with a short canon in the middle, it works. Still staying close together in one corner, use the back of the space. Motif not clear yet, pick one gesture and repeat it.'],
  [0, '11:08', ['Amelia'], 'Added a sharp sudden section after the slow opening, lovely contrast. Travel into the space is quicker now. Still very little stillness, hold the arabesque for longer.'],
  [0, '11:14', ['Mia'], 'Started developing the leap and wavy arms motif with retrograde, really clever. Accents still strong. Needs the strong, sudden contrast when the music goes quiet.'],
  [0, '11:20', ['Dolcie'], 'Bigger steps today and using more of the floor. Transition into the floor is still rushed, slow it down and use a count of four. Hand gesture motif is clear.'],
  [0, '13:30', ['Oscar', 'Lily', 'Noah'], 'Group devising: changeovers much smoother after rehearsing them. Still image is strong. Facing the audience more would help, a lot of backs to the front. Ending still a bit unclear.'],
  [0, '13:38', ['Grace', 'Evie'], 'Grace and Evie led the flashback scene well, clear change in voice and posture for the past. Need to project more, hard to hear from the back.'],
  [0, '13:44', ['Harry'], 'Much better at listening today and let the others share ideas. Strong stage presence. Rushes his lines when nervous, slow down and use pauses.'],
  [0, '11:52', ['Zara'], 'Caught up on the set phrase from the video, nearly all of it is there. Arms are behind the counts in the second half. Good effort after missing lessons.'],
  [1, '13:40', ['Elliana'], 'Very creative. All five sections in, pathways really effective, dynamics good. Gestures clear at the start but by the end they merge into one and look like an afterthought. Everything is the same quality, needs sustained movement and some stillness. Motif starting to come through but not complete yet.'],
  [1, '13:52', ['Annabel'], 'Engaging, musicality lovely, hits the key beats. Strong formation, changes direction well. Whole piece is in unison so it looks like a solo taught to two others. Stays in one area close together. No clear motif.'],
  [1, '14:05', ['Amelia'], 'Lovely solo, jumps turns gestures and travel all there. Slow sustained quality is beautiful. Hardly any stillness. Mostly slow, needs some sharp or sudden movement. Takes a long time to get into the space. Could use the reach to the side or the scoop as a motif.'],
  [2, '09:20', ['Mia'], 'Great music choice and she hits the accents. Clear motif, leap into wavy arms, repeated throughout. Now needs developing, retrograde or fragment it. All graceful and light, needs strong and sudden contrast. When the music goes quiet she stays the same speed, could be a contrasting section B.'],
  [2, '09:34', ['Dolcie'], 'Very pretty dance. Starting to hit some accents. Clear motif with the hand gesture going down to the floor. Good to see the new movements we worked on. Transition out of the step turn and leap turn into the floor is rushed. Dancing quite small, bigger steps.'],
  [3, '11:10', ['Ruby', 'Isla', 'Maddie', 'Elliana'], 'Warm up was focused today and they helped set up the space without being asked.'],
  [6, '10:05', ['Annabel'], 'Absent first half, came in late from the music lesson. Caught up quickly.'],
  [7, '10:20', ['Paige'], 'Really clear gestures, arm focused style is distinctive. Steps are very small, she is dancing in about a one metre circle. Will come with confidence.'],
  [8, '14:15', ['Neve'], 'Movement content lovely. Turns and arabesques but no clear motif, try a gesture. Opening is all unison standing side by side.'],
  [10, '10:40', ['Jude', 'Dolly', 'Ame'], 'Struggled to agree on the ending, a bit of falling out. Settled once I gave them a time limit.'],
  [14, '10:30', ['Mia', 'Dolcie'], 'Both forgot kit, sat out and gave peer feedback instead. Feedback was thoughtful.'],
  [0, '14:10', ['Theo'], 'Theo delivered the monologue with real energy and passion. Pauses used well to land the key lines. Speech clear. Lost the character a bit in the middle when he got the giggles. Could add more emotion near the end.'],
  [0, '14:18', ['Freya'], 'Believable and engaging character, really original idea. Projection is quiet at the back. Rushed the last section.'],
  [0, '14:25', ['Leo'], 'Did not have his lines learned, read from the script. When he looked up the character was good. Needs to learn lines for Thursday.'],
  [0, '14:31', ['Ava'], 'Excellent. Consistent character throughout, good use of pauses, clear diction. The monologue had enough detail to be interesting. Try varying the pace more.'],
  [1, '09:15', ['Oscar', 'Lily', 'Noah'], 'Group devising: good still image at the start, clear levels. Transitions between scenes were messy and slow. Need to rehearse the changeovers.'],
  [1, '09:22', ['Grace', 'Harry', 'Evie'], 'Group devising: strong idea, the flashback worked well. Harry dominating the discussion, needs to let others contribute. Ending needs work.'],
  [4, '15:00', ['Lily'], 'Stayed behind to ask about the audition for the school show. Really keen.'],
  [9, '14:40', ['Noah'], 'Quiet and withdrawn today, not his usual self. Did take part in the group work.'],
  [0, '11:30', ['Sophie'], 'Technical accuracy in the set phrase is strong, good extension and alignment. Timing slips in the second half. Facial expression flat.'],
  [0, '11:38', ['Chloe'], 'Good spatial awareness and focus. Needs more control on the landing of the jump. Projection improving.'],
  [0, '11:45', ['Ellie', 'Hannah', 'Megan'], 'Duet and trio work: good use of contact, the lift was confident. Unison needs tightening, they drift apart on counts 5 to 8.'],
  [2, '11:20', ['Zara'], 'Missed the last two lessons. Needs to catch up on the set phrase, gave her the video link.'],
  [5, '11:15', ['Megan'], 'Brilliant written evaluation, used subject terminology well, really detailed on choreographic devices.'],
];

export async function seed() {
  const year = schoolYearFor();
  const classes = [], pupils = [], notes = [];
  const byFirst = new Map();
  for (const [name, list] of Object.entries(CLASSES)) {
    const klass = { id: crypto.randomUUID(), name };
    classes.push(klass);
    for (const full of list) {
      const p = { id: crypto.randomUUID(), name: full, class_id: klass.id };
      pupils.push(p);
      byFirst.set(full.split(' ')[0], p);
    }
  }
  const now = new Date();
  for (const [ago, time, who, text] of NOTES) {
    const [h, m] = time.split(':').map(Number);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, h, m);
    if (at > now) at.setDate(at.getDate() - 1);  // keep "today" notes in the past
    for (const first of who) {
      const p = byFirst.get(first);
      if (p) notes.push({ id: crypto.randomUUID(), pupil_id: p.id, text, created_at: at.toISOString() });
    }
  }
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('Data', { create: true });
  const file = await dir.getFileHandle(`${year}.json`, { create: true });
  const w = await file.createWritable();
  await w.write(JSON.stringify({ app: 'pupil-notes', version: 3, school_year: year, classes, pupils, notes }, null, 2));
  await w.close();
}
