// Short, human messages for backend failures. The widget and the HUD retry line show
// these as-is; the raw status and body go to the log only.
export const OFFLINE_MESSAGE = "Backend offline";

/** Message for an HTTP error status; 501 is the backend's "not implemented yet". */
export const httpErrorMessage = (status: number): string =>
  status === 501 ? "Not available yet" : `Backend error (${status})`;
