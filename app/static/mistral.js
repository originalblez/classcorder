// Calls Mistral's API directly from the browser with the user's own key.
// The key is sent only to api.mistral.ai; the page's CSP blocks any other destination.

const API = 'https://api.mistral.ai/v1';
const TRANSCRIBE_MODEL = 'voxtral-mini-latest';
const POLISH_MODEL = 'mistral-large-latest';

// Published prices in USD, used only for the cost estimate shown after each note.
// Check https://mistral.ai/pricing and update if they change.
const PRICE_TRANSCRIBE_PER_MINUTE = 0.003;
const PRICE_POLISH_INPUT_PER_M = 0.5;
const PRICE_POLISH_OUTPUT_PER_M = 1.5;

const POLISH_PROMPT = `You tidy a speech-to-text transcript of a teacher's spoken note about a pupil into a formal school record entry.
The transcript is given between <transcript> tags. It is the only source of information.
Rules:
- Professional British English, first person, in the transcript's own tense. Write in the teacher's own voice: never refer to "the teacher" in the third person.
- Use only what the transcript says. Never add, infer, interpret, soften, strengthen or remove anything. If a word seems wrong or unclear, keep it as it is rather than guessing what was meant. Keep numbers and time words such as "today".
- Keep names exactly as written.
- Fix grammar and punctuation. Remove filler words, false starts and repetition.
- Keep the teacher's own wording where possible; change words only to fix grammar or make the tone formal.
- Keep it about the same length as the transcript.
- If the transcript is very short, unclear or not a note about a pupil, return it with only punctuation fixed. Never invent content to fill it out.
- Reply with the rewritten note only, with no tags or comments.`;

// Transcripts shorter than this are kept as they are; there is nothing to tidy.
const MIN_WORDS_TO_POLISH = 6;

// Function and linking words a formal rewrite may legitimately introduce.
const ALLOWED_NEW_WORDS = new Set(('also then this that these those they them their there which while when with into from ' +
  'have been were will would could should about after before during within without because however although ' +
  'very well some most more much each such being does what where pupil child though appeared seemed appears seems').split(' '));

// Content words in the tidied text that never appear in the transcript. A large number
// means the model has made something up.
function addedWords(source, output) {
  const words = s => s.toLowerCase().match(/[a-z']+/g) ?? [];
  const sourceWords = new Set(words(source));
  const content = words(output).filter(w => w.length >= 4 && !ALLOWED_NEW_WORDS.has(w));
  const added = [...new Set(content.filter(w => !sourceWords.has(w)))];
  return { added, ratio: content.length ? added.length / new Set(content).size : 0 };
}

export class ApiKeyError extends Error {}

async function call(path, key, init) {
  let res;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...init?.headers } });
  } catch {
    throw new Error('Could not reach Mistral. Check the internet connection.');
  }
  if (res.status === 401) throw new ApiKeyError('Mistral rejected the API key.');
  if (res.status === 429) throw new Error('Mistral rate limit or spending limit reached. Try again shortly.');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Mistral error ${res.status}: ${body.message || body.detail || res.statusText}`);
  }
  return res.json();
}

export const checkKey = key => call('/models', key, { method: 'GET' });

// Words teachers often use in notes, passed as spelling hints after the pupil names.
const CLASSROOM_TERMS = ('chatty unsettled settled distracted focused engaged disengaged fidgety tearful anxious ' +
  'withdrawn confident resilient cooperative disruptive phonics comprehension inference fluency handwriting ' +
  'spelling punctuation grammar times_tables number_bonds fractions homework reading_book behaviour ' +
  'attendance playtime lunchtime SENCO EHCP IEP TA intervention safeguarding').split(' ');

// names: pupil names, passed as spelling hints so they are transcribed correctly.
// seconds: recording length, used for the cost estimate if Mistral doesn't report it.
// Returns { text, cost }.
export async function transcribe(key, blob, names = [], seconds = 0) {
  const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('file', blob, `note.${ext}`);
  form.append('model', TRANSCRIBE_MODEL);
  form.append('language', 'en');
  // Context bias takes up to 100 terms; multi-word phrases use underscores. Names come first.
  const hints = [...names.map(n => n.trim().replace(/\s+/g, '_')), ...CLASSROOM_TERMS];
  for (const hint of hints.slice(0, 100)) form.append('context_bias', hint);
  const out = await call('/audio/transcriptions', key, { method: 'POST', body: form });
  const audioSeconds = out.usage?.prompt_audio_seconds ?? seconds;
  return { text: out.text.trim(), cost: (audioSeconds / 60) * PRICE_TRANSCRIBE_PER_MINUTE };
}

// Returns { text, cost, skipped, rejected, added }. skipped: too short to tidy, so the
// transcript is returned unchanged. added: words in the tidied text that weren't in the
// transcript, for the teacher to check. rejected: almost all of it was new, so the
// transcript is returned instead.
export async function polish(key, transcript) {
  if ((transcript.match(/\S+/g) ?? []).length < MIN_WORDS_TO_POLISH) {
    return { text: transcript, cost: 0, skipped: true };
  }
  const out = await call('/chat/completions', key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: POLISH_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: POLISH_PROMPT },
        { role: 'user', content: `<transcript>\n${transcript}\n</transcript>` },
      ],
    }),
  });
  const usage = out.usage ?? {};
  const cost = ((usage.prompt_tokens ?? 0) * PRICE_POLISH_INPUT_PER_M + (usage.completion_tokens ?? 0) * PRICE_POLISH_OUTPUT_PER_M) / 1e6;
  const text = out.choices[0].message.content.replace(/<\/?transcript>/g, '').trim();
  const { added, ratio } = addedWords(transcript, text);
  if (added.length >= 4 && ratio >= 0.8) return { text: transcript, cost, rejected: true, added };
  return { text, cost, added };
}

// Rough conversion for display only; Mistral bills in USD.
const GBP_PER_USD = 0.75;

// Shows the estimate in pounds, or in pence when under £1.
export function formatCost(usd) {
  const gbp = usd * GBP_PER_USD;
  if (gbp >= 1) return `~£${gbp.toFixed(2)}`;
  const pence = gbp * 100;
  return `~${pence < 0.1 ? pence.toFixed(3) : pence.toFixed(2)}p`;
}
