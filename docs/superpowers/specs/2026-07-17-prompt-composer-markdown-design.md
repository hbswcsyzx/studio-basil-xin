# Prompt Composer And Markdown Design

## Scope

Refine the inline prompt-collaboration composer and assistant-message presentation without changing collaboration memory, upstream requests, or the surrounding studio layout.

## Composer Behavior

- The empty composer is exactly one text line high.
- It grows for explicit newlines and wrapped text until four visible lines.
- Content beyond four lines scrolls inside the composer.
- Native manual resizing is removed so the composer has predictable behavior.
- Sending or resetting returns the composer to one line.

## Message Rendering

- Assistant messages render Markdown, including emphasis, headings, lists, blockquotes, links, inline code, and fenced code blocks.
- GitHub-flavored Markdown features are supported.
- Raw HTML is not rendered.
- User messages remain plain text so their submitted wording is shown exactly as entered.

## Verification

Component tests cover the one-line baseline, four-line cap, overflow behavior, and assistant-only Markdown. Production build and browser measurements verify the final layout.
