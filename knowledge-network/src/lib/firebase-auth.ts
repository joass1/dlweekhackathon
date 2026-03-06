import { getAuth, RecaptchaVerifier } from "firebase/auth";
import { app } from "./firebase";

const auth = getAuth(app);

let recaptchaVerifier: RecaptchaVerifier | null = null;

/**
 * Returns a cached invisible RecaptchaVerifier bound to the given container element.
 * Creates a new one if none exists or the previous was cleared.
 */
export function getRecaptchaVerifier(
  containerId = "recaptcha-container"
): RecaptchaVerifier {
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: "invisible",
    });
  }
  return recaptchaVerifier;
}

/** Clear the cached verifier (call after auth actions complete or on error). */
export function clearRecaptchaVerifier() {
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
    recaptchaVerifier = null;
  }
}

export { auth };
