import { Fragment, type ReactNode } from "react";

import type { MessengerTextLink } from "./types.js";

type RichMessageTextProps = Readonly<{
  text: string;
  links?: readonly MessengerTextLink[];
}>;

export function RichMessageText({
  text,
  links = []
}: RichMessageTextProps) {
  const nodes = richTextNodes(text, links);
  return <>{nodes}</>;
}

function richTextNodes(
  text: string,
  links: readonly MessengerTextLink[]
): ReactNode {
  if (links.length === 0 || links.length > 64) {
    return text;
  }
  const characters = Array.from(text);
  const ordered = [...links].sort((left, right) =>
    left.offset - right.offset
  );
  let cursor = 0;
  for (const link of ordered) {
    if (
      !Number.isSafeInteger(link.offset) ||
      !Number.isSafeInteger(link.length) ||
      link.offset < cursor ||
      link.length < 1 ||
      link.offset + link.length > characters.length ||
      !safeHttpsUrl(link.url)
    ) {
      return text;
    }
    cursor = link.offset + link.length;
  }

  const output: ReactNode[] = [];
  cursor = 0;
  for (const [index, link] of ordered.entries()) {
    if (link.offset > cursor) {
      output.push(
        <Fragment key={`text-${String(index)}`}>
          {characters.slice(cursor, link.offset).join("")}
        </Fragment>
      );
    }
    output.push(
      <a
        key={`link-${String(index)}`}
        href={link.url}
        target="_blank"
        rel="noreferrer noopener"
      >
        {characters.slice(link.offset, link.offset + link.length).join("")}
      </a>
    );
    cursor = link.offset + link.length;
  }
  if (cursor < characters.length) {
    output.push(
      <Fragment key="text-tail">{characters.slice(cursor).join("")}</Fragment>
    );
  }
  return output;
}

function safeHttpsUrl(value: string): boolean {
  if (value.length > 4_096) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.hostname.length > 0;
  } catch {
    return false;
  }
}
