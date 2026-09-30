// Shared passcode check. Files starting with "_" are not exposed as routes on Vercel.
export function checkPasscode(req, res) {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return true; // no passcode configured (fine for local dev only)
  if (req.headers["x-app-passcode"] === expected) return true;
  res.status(401).json({ error: "passcode" });
  return false;
}
