// lessons.js — every lesson of the guided exercises and every user-facing string of the
// Exercises tab (pure data; tests/exercises/lessons-test.js checks the wording: no
// verdict, score or streak words, every direction resolves to text, a safety line on
// every lesson that uses the voice). Design: docs/guided-exercises-design.md.
//
// First version (2026-10-26): the lessons that need no new measurement — S1, W1 (done by
// feel; the design's live trace waits for M2, the pitch chain on hums and lip trills), W2,
// P5, P6, R1–R4. The ids are the design's and are what exerciseResults rows store.
//
// Direction-dependent text: a string, or an object keyed by training direction
// ("feminine" | "masculine" | "androgynous" | "exploring"), with "target" for the three
// directions that have a pitch band and "all" as the fallback. A lesson opened with no
// goal chosen yet uses the "exploring" text (no band, no aim).
//
// Card kinds (LessonPlayer.jsx draws them):
//   intro    the lesson's purpose and why it works
//   text     a heading, paragraphs, an optional list
//   live     text above the live pitch trace (the target band); measure: "count" collects
//            the frames the result is computed from; optional: true = no mic button
//   record   text above a take recorder (takes: [{ id, label }])
//   compare  playback of every take recorded in the lesson
//   hear     "Hear it first": record, then the resonance-only versions (Voice Shaper)
//   aim      what you're aiming for, and what to do if it isn't working
// Every lesson ends with the result card, which LessonPlayer adds.

export const DIRECTIONS = Object.freeze(["feminine", "masculine", "androgynous", "exploring"]);

/** The text for a direction (see the header). Arrays resolve element by element; null / undefined stay. */
export function forDir(value, direction) {
  const dir = DIRECTIONS.includes(direction) ? direction : "exploring";
  if (value == null || typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((v) => forDir(v, dir)).filter((v) => v != null);
  if (typeof value === "object") {
    if (dir in value) return forDir(value[dir], dir);
    if (dir !== "exploring" && "target" in value) return forDir(value.target, dir);
    if ("all" in value) return forDir(value.all, dir);
    return null;
  }
  return value;
}

// ------------------------------------------------------------------ shared lines

/** The standard safety line (design §3). */
export const SAFETY = "Stop if it hurts, scratches or makes you want to cough. If it's work, make it smaller.";

const PITCH_SAFETY = {
  feminine: "Higher should feel lighter, not squeezed. If it tightens, come down a little.",
  masculine: "Lower should feel relaxed and full. Don't press down, tuck your chin, or drop into a creaky voice to sound low.",
  androgynous: "Higher should feel lighter, not squeezed, and lower should feel relaxed, not pressed down. If it tightens, come back toward your easy voice.",
  exploring: "Stay in the range that feels comfortable.",
};

const RESONANCE_SAFETY = {
  feminine: "Bright, not tight: keep your jaw loose and the smile small.",
  masculine: "Dark, not muffled: let the sound come forward to your lips, and don't push your voice box down.",
  all: "Bright, not tight: keep your jaw loose and the smile small. Dark, not muffled: let the sound come forward to your lips, and don't push your voice box down.",
};

/** The sentence both resonance-recording lessons use (all voiced sounds, so every bit of it carries the voice). */
export const SENTENCE = "We were away a year ago.";

const BAND_LINE = {
  target: "The shaded band on the chart is the pitch range for your goal: {band}.",
  exploring: "With “Just exploring” there's no band: the chart just shows where your voice goes.",
};

// ------------------------------------------------------------------ the lessons

export const LESSONS = Object.freeze({
  S1: {
    id: "S1",
    title: "How to practise safely",
    purpose: "Read this once before your first lesson.",
    usesVoice: false,
    cards: [
      {
        kind: "intro",
        title: "Practise little and often",
        body: [
          "5 to 15 minutes at a time is plenty. Short sessions on most days do more than one long one.",
          "Start with the warm-up and finish with the cool-down: both are lessons here.",
        ],
      },
      {
        kind: "text",
        title: "Stop and rest if you notice",
        list: [
          "pain, or a raw or scratchy throat",
          "a tickle that makes you cough or clear your throat",
          "your voice cracking or cutting out more than usual",
          "hoarseness, or a tired voice the next morning",
        ],
        body: [
          "Rest means a break from practice and an easy, everyday speaking voice. Drink some water, and swallow or sip instead of clearing your throat.",
          "Skip practice while you have a cold or a sore throat.",
        ],
      },
      {
        kind: "text",
        title: "When to get help",
        body: [
          "If you're hoarse for more than three weeks, or speaking hurts, see a doctor.",
          "See a doctor soon if you lose your voice suddenly, swallowing hurts, you cough up blood, or breathing is hard.",
          "Syrinx is not a voice teacher or a speech therapist. If you can, work with one as well, especially if you're changing your voice a lot or it tires easily.",
        ],
      },
      {
        kind: "text",
        title: "Trust how your voice feels",
        body: [
          "The app compares you with yourself, never with other people's voices. Its numbers can be off, for example in a noisy room. Trust how your voice feels over any number.",
          "Nothing you say in a lesson is saved as audio. Recordings stay on the page and are gone when you leave it.",
        ],
      },
    ],
    result: { byFeel: false, done: "That's all. You can read this again at any time from the lesson list." },
  },

  W1: {
    id: "W1",
    title: "Warm-up: straw or lip buzz",
    purpose: "Wake your voice gently before you practise.",
    usesVoice: true,
    cards: [
      {
        kind: "intro",
        body: [
          "Partly closing your mouth, with a straw or with buzzing lips, gives your voice a little back-pressure. That helps your vocal folds vibrate easily, with less effort (Titze 2006). Voice teachers and speech therapists often use it as a gentle warm-up.",
          "This one is done by feel: the app doesn't measure it.",
        ],
      },
      {
        kind: "text",
        title: "Get ready",
        body: [
          "A drinking straw, if you have one. Sit or stand comfortably, with your shoulders down and your jaw loose.",
        ],
        safety: [SAFETY, "If you feel light-headed, stop and breathe normally for a moment."],
      },
      {
        kind: "text",
        title: "Hum through the straw",
        body: [
          "Hold the straw between your lips and seal them around it. Make an easy “oo” sound into the straw for 3 to 5 seconds, then breathe. Do it five times.",
          "All the air should go through the straw: if you gently pinch your nose, nothing should change.",
          "No straw? Do a lip buzz instead: let your lips flap loosely while you make an easy voiced sound, like a motorboat. If they won't keep buzzing, press lightly on your cheeks beside the corners of your mouth.",
        ],
      },
      {
        kind: "text",
        title: "Slow slides",
        body: [
          "On the straw or the lip buzz, slide slowly up a little and back down, like a gentle siren. Do five slides.",
          "Stay in the comfortable middle of your voice. It doesn't need to go high or low.",
        ],
      },
      {
        kind: "aim",
        body: [
          "An easy buzz at your lips and the front of your face, and a throat that feels loose. Your voice should feel easier afterwards, not tired.",
        ],
        troubleshooting: [
          "If it feels like pushing air, use less air and a softer sound.",
          "If your lips stop buzzing, use less air and let them go looser.",
        ],
      },
    ],
    result: { byFeel: true, done: "Done by feel: the app doesn't measure the warm-up." },
  },

  W2: {
    id: "W2",
    title: "Cool-down: sighs",
    purpose: "Let your voice settle after you practise.",
    usesVoice: true,
    cards: [
      {
        kind: "intro",
        body: [
          "Practising away from your usual voice uses your muscles in new ways. A few relaxed sighs and some easy talking let them settle, the way a stretch ends a workout.",
        ],
      },
      {
        kind: "text",
        title: "Get ready",
        body: [
          "Let your shoulders drop and your jaw hang loose. Breathe in slowly through your nose.",
        ],
        safety: [SAFETY],
      },
      {
        kind: "live",
        title: "Sighs",
        live: { optional: true },
        body: [
          "Let the breath out on a gentle, voiced sigh that falls from a comfortable high note to a low one, like the “haaah” when you sit down after a long day. Do five, with a slow breath between them.",
          "Let each sigh fade out before it gets creaky. You don't need to reach the bottom of your voice.",
          "If the mic is on, the chart shows each sigh. The line may break up on breathy sighs; that's fine.",
        ],
      },
      {
        kind: "text",
        title: "Easy talking, then rest",
        body: [
          "Say a few everyday things in whatever voice feels easiest right now: “okay”, “all right”, “thank you”, “see you tomorrow”.",
          "Then rest your voice quietly for a minute, and drink some water.",
        ],
      },
      {
        kind: "aim",
        body: [
          "A loose, easy throat.",
        ],
        troubleshooting: [
          "If your voice still feels tight or tired after the cool-down, rest it for the rest of the day.",
        ],
      },
    ],
    result: { byFeel: true, done: "Done by feel." },
  },

  P5: {
    id: "P5",
    title: { target: "Glide to your target", exploring: "Glides" },
    purpose: {
      target: "Feel your way into your target pitch with a smooth slide.",
      exploring: "Explore your pitch range with smooth slides.",
    },
    usesVoice: true,
    cards: [
      {
        kind: "intro",
        body: [
          "A slide changes your pitch gradually, so you can feel the change happen instead of jumping to a note and squeezing.",
          {
            target: "The chart shows where your voice is, so you can find the band by ear and by sight. Stopping inside it for a moment teaches you what that pitch feels like.",
            exploring: "The chart shows where your voice goes, with no target.",
          },
        ],
      },
      {
        kind: "text",
        title: "Get ready",
        body: [
          "Turn on the mic. Sit or stand comfortably, with your jaw loose.",
          BAND_LINE,
        ],
        safety: [SAFETY, PITCH_SAFETY],
      },
      {
        kind: "live",
        title: "Slide on “oo”",
        live: {},
        body: [
          {
            feminine: "Start on a comfortable low “oo” (as in “who”) and slide slowly up until the line is inside the band. Stay there for a moment, then slide back down. Do it three times.",
            masculine: "Start on a comfortable “oo” (as in “who”) and slide slowly down until the line is inside the band. Stay there for a moment, then slide back up. Do it three times. If you're already in the band, slide around inside it.",
            androgynous: "Start on a comfortable low “oo” (as in “who”) and slide slowly up into the band. Stay there for a moment. Then start on a comfortable higher “oo” and slide down into the band. Do each twice.",
            exploring: "Start on a comfortable low “oo” (as in “who”) and slide slowly up to a comfortable high one, then back down. Do it three times and watch where the line goes.",
          },
          {
            target: "Go only as far as is easy. If the band feels like work, stop short of it: getting closer over weeks is the aim, not reaching it today.",
          },
        ],
      },
      {
        kind: "live",
        title: "Land on a word",
        live: {},
        body: [
          {
            feminine: "Slide up into the band on “oo”. When you're there, say “one… two… three” slowly on that same note. Do it three times.",
            masculine: "Slide down into the band on “oo”. When you're there, say “one… two… three” slowly on that same note. Do it three times.",
            androgynous: "Slide into the band on “oo”, from below or from above. When you're there, say “one… two… three” slowly on that same note. Do it three times.",
            exploring: "Slide to a note you like, then say “one… two… three” slowly on it. Try it on three different notes.",
          },
          { target: "If the note feels like work, land a little short of the band." },
        ],
      },
      {
        kind: "aim",
        body: [
          "Smooth slides with no jumps, and an easy feeling wherever you stop.",
          PITCH_SAFETY,
        ],
        troubleshooting: [
          "If your voice cracks or flips on the way, slide more slowly and more quietly. It often happens at the same spot each time, and gets smoother with practice.",
          { masculine: "If you're on testosterone, your voice may still be getting lower: the band can get easier over months." },
        ],
      },
    ],
    result: { byFeel: true, done: "Done. The glides aren't measured: the chart was there to guide you." },
  },

  P6: {
    id: "P6",
    title: { target: "Count on your target", exploring: "Count and listen" },
    purpose: {
      target: "Carry your target pitch into speech, starting with counting.",
      exploring: "See where your speaking pitch sits.",
    },
    usesVoice: true,
    measures: true,
    cards: [
      {
        kind: "intro",
        body: [
          "Counting is speech without having to think about what to say, so you can pay attention to your pitch. Short everyday phrases come next.",
          {
            target: "The colour of the line follows your pitch level, the middle of your last second and a half of voice, so the normal ups and downs of speech don't change it.",
            exploring: "The app follows your pitch level, the middle of your last second and a half of voice, so the normal ups and downs of speech don't change it.",
          },
        ],
      },
      {
        kind: "text",
        title: "Get ready",
        body: [
          { target: "Turn on the mic. If you've done “Glide to your target”, slide into the band once on “oo” to find it.", exploring: "Turn on the mic." },
          BAND_LINE,
          { androgynous: "This band is narrow. Even a voice centred in it reads inside it only about two-thirds of the time, so don't expect a high share here." },
        ],
        safety: [SAFETY, PITCH_SAFETY],
      },
      {
        kind: "live",
        title: "Count to ten",
        live: { measure: "count" },
        body: [
          {
            target: "Count from one to ten, slowly, with your pitch in the band. Keep it sounding like speech: let it rise and fall a little, as it does when you talk.",
            exploring: "Count from one to ten, slowly, in your everyday voice.",
          },
        ],
      },
      {
        kind: "live",
        title: "Short phrases",
        live: { measure: "count" },
        body: [
          { target: "Now say these, one at a time, in the band:", exploring: "Now say these, one at a time, in your everyday voice:" },
        ],
        list: [
          "Good morning, how are you?",
          "Could I get a coffee, please?",
          "I'll see you on Friday.",
          "Thanks, that's really kind of you.",
          "Where did you find that?",
        ],
      },
      {
        kind: "aim",
        body: [
          { target: "Easy speech in or near the band. It's normal for parts to fall outside it: speech moves.", exploring: "Easy, everyday speech." },
          PITCH_SAFETY,
        ],
        troubleshooting: [
          { target: "If it takes effort to stay in the band, speak a little closer to your easy voice. Easy and close is better than strained and in the band." },
          "If the chart shows nothing while you speak, move closer to the mic, or speak a little louder.",
        ],
      },
    ],
    result: { byFeel: true },
  },

  R1: {
    id: "R1",
    title: "Find your voice box",
    purpose: "Find your voice box and feel it move. Its height changes how big or small your voice sounds.",
    usesVoice: true,
    cards: [
      {
        kind: "intro",
        body: [
          "Your voice box (larynx) sits at the front of your neck. On many necks you can see or feel it as a bump. It rises when you swallow and drops when you yawn.",
          "A higher voice box makes the space above it shorter, which sounds smaller and brighter. A lower one makes it longer, which sounds bigger and darker. With practice you can move it a little on purpose while you speak.",
          { masculine: "Research on this is still small: one published case study followed one transmasculine speaker through a voice session (Buckley et al. 2020). Changes like this come from gentle practice repeated over weeks, not from one big push." },
        ],
      },
      {
        kind: "text",
        title: "Get ready",
        body: [
          "Rest two fingertips lightly on the front of your neck: on the bump if you can find it, or on the middle of your neck if you can't.",
        ],
        safety: ["Touch lightly. Never press on your throat.", SAFETY],
      },
      {
        kind: "text",
        title: "Swallow",
        body: ["Swallow once. Feel the voice box rise, then drop back to where it rests."],
      },
      {
        kind: "text",
        title: "Yawn",
        body: ["Start a slow yawn. Feel the voice box drop, lower than where it rests. Then let it come back."],
      },
      {
        kind: "text",
        title: "Pitch and height",
        body: [
          "With your fingers still there, say “hmm?” as a question, from low to high. You may feel the voice box rise a little with the pitch.",
          "That's normal: pitch and voice-box height tend to move together. The resonance lessons work on the size of the sound without changing the pitch.",
        ],
      },
      {
        kind: "aim",
        body: [
          "Small, easy movements: you're only noticing them.",
          {
            feminine: "Don't squeeze to hold the voice box up.",
            masculine: "Never press the voice box down with your hand or by tucking your chin.",
            all: "Don't squeeze to hold the voice box up, and never press it down with your hand or by tucking your chin.",
          },
        ],
        troubleshooting: [
          "Can't feel it move? That's common. Try the swallow again slowly, or go on to “Big dog, little dog”: you can hear the change even when you can't feel it.",
        ],
      },
    ],
    result: { byFeel: true, done: "Done by feel: there's nothing to measure here." },
  },

  R2: {
    id: "R2",
    title: "Big dog, little dog",
    purpose: "Learn to move your voice box up and down on purpose, by panting.",
    usesVoice: true,
    cards: [
      {
        kind: "intro",
        body: [
          "When you pant like a big dog, your voice box drops and the space above it gets longer. When you pant like a little dog, it rises and the space gets shorter.",
          "Copying the sound gets your throat to do it, without having to find the muscles.",
        ],
      },
      {
        kind: "text",
        title: "Get ready",
        body: [
          "Rest your fingers lightly on your voice box, as in “Find your voice box”. Open your mouth and let your tongue relax forward.",
          "Keep the panting soft and whispered, never forced.",
        ],
        safety: [SAFETY, "Panting can make you light-headed. Do a few at a time, and breathe normally in between. Sip some water afterwards.", "Let the voice box move on its own: never push it down or squeeze it up."],
      },
      {
        kind: "text",
        title: "Big dog",
        body: ["Pant slowly and deeply in a soft whisper, like a big, tired dog. Feel the voice box drop. Five pants."],
      },
      {
        kind: "text",
        title: "Little dog",
        body: ["Now pant lightly, like a small, excited dog. The whisper sounds smaller and brighter, and the voice box rises. Five pants."],
      },
      {
        kind: "text",
        title: "Switch",
        body: [
          "Alternate: three big, three little.",
          "Then do the little dog slowly, at the big dog's speed, so only the size changes.",
        ],
      },
      {
        kind: "record",
        title: "Hear the difference (optional)",
        body: [
          "Whisper “ha ha ha” as the big dog and record it, then as the little dog. Play them back one after the other.",
          "The app doesn't measure whispers: this is for your ears.",
        ],
        takes: [{ id: "big", label: "Big dog" }, { id: "little", label: "Little dog" }],
        compare: true,
      },
      {
        kind: "aim",
        body: [
          {
            feminine: "You'll use the little dog's position for a brighter voice. It should feel light. If your throat feels squeezed, or as if you're about to swallow, let it go.",
            masculine: "You'll use the big dog's position for a bigger, darker voice. It should feel open and relaxed, never pushed down.",
            androgynous: "Get to know both ends, then find a spot in between that feels easy.",
            exploring: "Neither one is right: they're two ends to explore.",
          },
        ],
        troubleshooting: [
          "If the voice box doesn't seem to move, make the pants bigger and slower, and check that you're whispering, not using your voice.",
        ],
      },
    ],
    result: { byFeel: true, done: "Done by feel and by ear: whispers can't be measured." },
  },

  R3: {
    id: "R3",
    title: "Tongue and lips",
    purpose: "Learn two resonance controls you can feel directly: where your tongue sits, and the shape of your lips.",
    usesVoice: true,
    cards: [
      {
        kind: "intro",
        body: [
          "The space between your voice box and your lips shapes the sound, a bit like the body of an instrument. Spreading your lips a little and moving your tongue forward make the sound brighter. Rounding your lips and letting your tongue sit back make it darker.",
          {
            feminine: "In a small study, ten trans women practised the bright version for five sessions. Afterwards their resonance measured brighter, and on average listeners heard their voices as more feminine (Carew, Dacakis & Oates 2007).",
            masculine: "Rounded lips make the space your voice sounds in a little longer, which makes it sound bigger and darker.",
          },
        ],
      },
      {
        kind: "text",
        title: "Get ready",
        body: [
          "Slowly say “ee”, then “oo”, back and forth. On “ee”, feel your tongue move forward and up and your lips spread. On “oo”, feel your tongue pull back and your lips round.",
          "Turn on the mic for the next steps: you'll record yourself.",
        ],
        safety: [SAFETY, "Your jaw and tongue shouldn't ache. If they do, stop and let them relax.", RESONANCE_SAFETY],
      },
      {
        kind: "record",
        title: "Bright",
        body: [
          "Rest the tip of your tongue behind your bottom front teeth. Let the middle of your tongue rise a little, as for “ee”, and smile very slightly at the corners.",
          `Record yourself saying: “${SENTENCE}”`,
        ],
        takes: [{ id: "bright", label: "Bright" }],
      },
      {
        kind: "record",
        title: "Dark",
        body: [
          "Let your tongue rest a little lower and further back, as for “oh”. Don't pull it back. Round your lips slightly, as if you're about to say “oo”.",
          `Record the same sentence: “${SENTENCE}”`,
        ],
        takes: [{ id: "dark", label: "Dark" }],
      },
      {
        kind: "record",
        title: "In between",
        only: ["androgynous"],
        body: [
          "Rest your tongue in the middle of your mouth and let your lips relax, neither spread nor rounded.",
          `Record the same sentence: “${SENTENCE}”`,
        ],
        takes: [{ id: "middle", label: "In between" }],
      },
      {
        kind: "compare",
        title: "Compare",
        body: ["Play your recordings one after the other. Listen for the size and brightness of the sound, not the pitch."],
      },
      {
        kind: "aim",
        body: [
          {
            feminine: "The bright one. It should sound a little smaller and brighter, not squeezed. Keep your pitch where it was: this lesson is only about the mouth.",
            masculine: "The dark one. It should sound a little fuller and darker, not pushed down or muffled. Keep your pitch where it was: this lesson is only about the mouth.",
            androgynous: "The one in between: tongue in the middle, lips relaxed. Keep your pitch where it was: this lesson is only about the mouth.",
            exploring: "Neither one is right: listen to the difference.",
          },
          RESONANCE_SAFETY,
        ],
        troubleshooting: [
          "If you can't hear a difference, exaggerate both a lot, then bring them back halfway.",
          "If the bright one sounds tight or nasal, loosen your jaw and keep the smile small. If the dark one sounds muffled, let the sound come forward to your lips.",
        ],
      },
    ],
    result: { byFeel: true, done: "Done by ear. Your recordings stay on this page and are gone when you leave it." },
  },

  R4: {
    id: "R4",
    title: "Hear it first",
    purpose: {
      feminine: "Hear your own voice with a brighter resonance, so you know what you're aiming for.",
      masculine: "Hear your own voice with a darker resonance, so you know what you're aiming for.",
      all: "Hear your own voice with a brighter and a darker resonance, so you know what you're aiming for.",
    },
    usesVoice: true,
    cards: [
      {
        kind: "intro",
        body: [
          "It's hard to aim for a sound you've never heard in your own voice. Voice Shaper can change the resonance of a recording, how big or small the space sounds, and leave the pitch alone.",
          "It's a computer approximation: it shows the direction of a change, not exactly how your voice will sound when you make it.",
        ],
      },
      {
        kind: "text",
        title: "Get ready",
        body: [
          "Turn on the mic, and find a quiet spot. Headphones make the playback easier to hear.",
          `You'll say the same sentence a few times: “${SENTENCE}”`,
        ],
        safety: [SAFETY, RESONANCE_SAFETY],
      },
      {
        kind: "hear",
        title: "Record your usual voice",
        stage: "record",
        body: [`Say “${SENTENCE}” twice, slowly, in your usual voice, then press Stop. It needs at least 3 seconds.`],
      },
      {
        kind: "hear",
        title: "Listen",
        stage: "listen",
        body: [
          {
            feminine: "Play your recording, then the brighter version. Listen for the size and brightness of the sound: the pitch is the same.",
            masculine: "Play your recording, then the darker version. Listen for the size and brightness of the sound: the pitch is the same.",
            all: "Play your recording, then the brighter and the darker versions. Listen for the size and brightness of the sound: the pitch is the same.",
          },
        ],
      },
      {
        kind: "record",
        title: "Your try",
        body: [
          {
            feminine: "Now say it again, twice, aiming for the brighter version. Use what you found in “Tongue and lips” and “Big dog, little dog”, not a higher pitch. Record it.",
            masculine: "Now say it again, twice, aiming for the darker version. Use what you found in “Tongue and lips” and “Big dog, little dog”, not a lower pitch. Record it.",
            all: "Now say it again, twice, aiming for one of the changed versions. Use what you found in “Tongue and lips” and “Big dog, little dog”, not a different pitch. Record it.",
          },
        ],
        takes: [{ id: "try", label: "Your try" }],
        compareWithHear: true,
      },
      {
        kind: "aim",
        body: [
          "Closer, not identical: the changed version is only an approximation. Keep your pitch where it was; this is about the space, not the note.",
          RESONANCE_SAFETY,
        ],
        troubleshooting: [
          "If you can't hear the difference in the changed version, listen with headphones, and play the two right after each other.",
        ],
      },
    ],
    result: { byFeel: true, done: "Done by ear. Your recordings stay on this page and are gone when you leave it." },
  },
});

/** Resonance-only shifts for "Hear it first", in percent of the formant scale (Voice Shaper's resonance slider). */
export const HEAR_SHIFT_PCT = 10;
export function hearShifts(direction) {
  if (direction === "feminine") return [HEAR_SHIFT_PCT];
  if (direction === "masculine") return [-HEAR_SHIFT_PCT];
  return [HEAR_SHIFT_PCT, -HEAR_SHIFT_PCT];
}

export const GROUPS = Object.freeze([
  { id: "start", title: "Start here", lessons: ["S1"] },
  { id: "warm", title: "Warm-up and cool-down", lessons: ["W1", "W2"] },
  { id: "pitch", title: "Pitch", lessons: ["P5", "P6"] },
  { id: "resonance", title: "Resonance", lessons: ["R1", "R2", "R3", "R4"] },
]);

/** Every lesson id in list order. */
export const LESSON_ORDER = Object.freeze(GROUPS.flatMap((g) => g.lessons));

/** The cards of a lesson for a direction (cards with `only` are left out for other directions). */
export function cardsFor(lesson, direction) {
  const dir = DIRECTIONS.includes(direction) ? direction : "exploring";
  return lesson.cards.filter((c) => !c.only || c.only.includes(dir));
}

/** The takes a lesson records, in order, for a direction. */
export function takesFor(lesson, direction) {
  return cardsFor(lesson, direction).flatMap((c) => c.takes ?? []);
}

// ------------------------------------------------------------------ the tab's own strings

export const UI = Object.freeze({
  tab: "Exercises",
  heading: "Exercises",
  intro: "Short lessons on pitch and resonance. Start with “How to practise safely”, then pick any lesson.",
  noGoal: "You haven't chosen a goal yet, so lessons show their “Just exploring” version. You can choose one in Settings.",
  later: "More lessons are coming: finding your easy note and range, holding and matching notes, and reading a passage to compare your resonance.",
  loading: "Loading exercises…",
  loadError: "The exercises could not load. Reload the page to try again.",
  notDone: "Not done yet",
  lastDone: "Last done",
  backToList: "Lessons",
  back: "Back",
  next: "Next",
  finish: "Finish",
  cardOf: (i, n) => `${i} of ${n}`,
  whyItWorks: "Why it works",
  aimTitle: "What you're aiming for",
  ifNot: "If it isn't working",
  safetyTitle: "Safety",
  micOff: "The mic is off.",
  turnOnMic: "Turn on the mic",
  // live view
  level: (hz) => `Pitch level: ${hz} Hz`,
  levelNone: "Pitch level: —",
  inBand: "in the band",
  belowBand: "below the band",
  aboveBand: "above the band",
  voiceSoFar: (s) => `Voice so far: ${s} s`,
  startOver: "Start this step over",
  // recorder
  record: "Record",
  stop: "Stop",
  recordAgain: "Record again",
  recording: (s) => `Recording… ${s} s of 8`,
  play: (label) => `Play ${label}`,
  playShort: "Play",
  stopPlayback: "Stop",
  notRecorded: "Not recorded yet",
  recorded: (s) => `${s} s`,
  readyIn: (s) => `Ready to record in ${s} s`,
  sessionGuard: "Playback is off while a session is being recorded, so it isn't saved as your voice.",
  listeningNote: "The mic hears the playback too. Headphones avoid that.",
  nothingToCompare: "Nothing recorded yet. Go back and record first.",
  // hear it first
  yourRecording: "Your recording",
  brighter: "Brighter",
  darker: "Darker",
  preparing: "Preparing the changed versions…",
  hearTooShort: "That was under 3 seconds. Please record at least 3 seconds.",
  hearNoVoice: "There wasn't enough voice in that recording. Record again and speak for a few seconds.",
  hearError: "Something went wrong while making the changed versions. Record again to try once more.",
  hearLoading: "Loading Voice Shaper…",
  hearUnsupported: "This browser can't run Voice Shaper (it needs WebAssembly).",
  hearCancelled: "Recording stopped because the mic was turned off.",
  hearRecordFirst: "Record your usual voice first (the step before).",
  // result
  resultTitle: "How did it go?",
  feelQuestion: "How did that feel?",
  feel: Object.freeze({ easy: "Easy", effort: "Some effort", strained: "Strained" }),
  feelReply: Object.freeze({
    easy: "Saved.",
    effort: "Saved. Some effort is normal while something is new. Keep it small and easy.",
    strained: "Saved. Stop for today and give your voice a rest. If it still feels strained tomorrow, rest another day. If it hurts, or you're hoarse for weeks, see a doctor.",
  }),
  coolDownNow: "Do the cool-down",
  nextLesson: (title) => `Next: ${title}`,
  // count result
  countLevel: (hz, note) => `Your pitch level: about ${hz} Hz (${note}).`,
  countInBand: (pct) => `In the band ${pct} % of the time you were speaking.`,
  countVoice: (s) => `From ${s} s of voice.`,
  countLast: (hz, pct) => (pct == null ? `Last time: about ${hz} Hz.` : `Last time: about ${hz} Hz, ${pct} % in the band.`),
  countTooLittle: "There wasn't enough voice to measure (it needs at least 3 seconds). You can go back and try the steps again.",
  countMicOff: "Nothing was measured: the mic was off.",
});

/** "Last done: today" / "yesterday" / "3 days ago" / a date (Intl; the list's row line). */
export function lastDoneText(atMs, nowMs = Date.now()) {
  if (!Number.isFinite(atMs)) return UI.notDone;
  const day = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const days = Math.round((day(nowMs) - day(atMs)) / 86400000);
  if (days <= 0) return `${UI.lastDone}: today`;
  if (days === 1) return `${UI.lastDone}: yesterday`;
  if (days < 7) return `${UI.lastDone}: ${days} days ago`;
  return `${UI.lastDone}: ${new Date(atMs).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
