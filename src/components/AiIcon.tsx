import { Codicon } from "./scm/Codicon";

/** One assistant mark, shared with the commit-message action. */
export function AiIcon({
  size = 16,
}: {
  size?: number;
  "aria-hidden"?: boolean | "true" | "false";
}) {
  return (
    <Codicon name="sparkle" style={{ fontSize: size, width: size, height: size }} />
  );
}
