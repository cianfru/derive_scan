/** Questions stay off unless the build sets VITE_QUESTIONS=1: no route, no nav entry, no link. */
export const QUESTIONS_ON = import.meta.env.VITE_QUESTIONS === "1";
