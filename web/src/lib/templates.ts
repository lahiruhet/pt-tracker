// The trainer's standard split, as sent to clients in WhatsApp.
export interface TemplateExercise {
  exercise: string;
  sets: string;
}

export const TEMPLATES: Record<string, TemplateExercise[]> = {
  "Upper 1": [
    { exercise: "Lat pulldown", sets: "3 x 10" },
    { exercise: "Wide bar row", sets: "2 x 10" },
    { exercise: "Incline DB press", sets: "3 x 8–10" },
    { exercise: "Shoulder press", sets: "2 x 8" },
    { exercise: "Lateral raise", sets: "2 x 10–12" },
    { exercise: "Face pull", sets: "2 x 10–12" },
    { exercise: "Preacher curl", sets: "2 x 10" },
  ],
  "Upper 2": [
    { exercise: "Bench press", sets: "2 x 8" },
    { exercise: "Cable row", sets: "3 x 10" },
    { exercise: "Chest fly", sets: "2 x 10" },
    { exercise: "Lateral raise", sets: "3 x 10" },
    { exercise: "Tricep pushdown", sets: "2 x 12" },
    { exercise: "Tricep overhead extension", sets: "2 x 12" },
    { exercise: "Seated DB curl", sets: "2 x 8" },
  ],
  Lower: [
    { exercise: "Squat", sets: "" },
    { exercise: "Leg extension", sets: "" },
    { exercise: "Hamstring curl", sets: "" },
    { exercise: "RDL", sets: "" },
    { exercise: "Bulgarian split squat", sets: "" },
    { exercise: "Calf raise", sets: "" },
  ],
};

export const TEMPLATE_NAMES = [...Object.keys(TEMPLATES), "Custom"];

/** Short names the trainer uses when sending weights in WhatsApp. */
const SHORT: Record<string, string> = {
  "Lat pulldown": "Lat pull",
  "Wide bar row": "Wide bar",
  "Incline DB press": "Incline press",
  "Lateral raise": "Lat raise",
  "Face pull": "Face pulls",
  "Tricep pushdown": "Tricep pushdown",
  "Tricep overhead extension": "Tricep ext",
  "Seated DB curl": "Seated bicep",
  "Bulgarian split squat": "Split squat",
  "Leg extension": "Extension",
  "Hamstring curl": "Hamstring",
};

export function shareName(exercise: string): string {
  return SHORT[exercise] ?? exercise;
}

/** Which template comes next for a client, following Upper 1 → Upper 2 → Lower. */
export function nextTemplate(lastWorkout: string | null | undefined): string {
  const order = ["Upper 1", "Upper 2", "Lower"];
  if (!lastWorkout) return "Upper 1";
  const w = lastWorkout.toLowerCase();
  const i = w.includes("upper 2") || w.includes("upper body 2") ? 1 : w.includes("upper") ? 0 : w.includes("lower") || w.includes("leg") ? 2 : -1;
  return i < 0 ? "Upper 1" : order[(i + 1) % 3];
}
