/**
 * useGeminiStream — Alice daemon adapter
 *
 * Routes all streaming calls to Alice's DaemonClient instead of the Gemini API.
 * The return interface is identical to the original useGeminiStream hook.
 */
export { useAliceStream as useGeminiStream } from '../../shim/hooks/useAliceStream.js';
