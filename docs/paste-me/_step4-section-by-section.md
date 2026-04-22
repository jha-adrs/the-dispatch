# Step 4 writing strategy — reference for all deep-dispatch prompts

Routine sessions can hit a stream-idle timeout when Claude emits a single 1500–2500 word response. To avoid this, **never ask Claude to write the whole markdown body in one message**. Instead, build `/tmp/dispatch.md` incrementally — one section per tool call.

## The pattern

```
a. Initialize the file with the header block (Bash):
   cat > /tmp/dispatch.md <<'EOF'
   # <title>

   **Date:** <today>
   **TL;DR:** <tl;dr>

   EOF

b. For each section, append via a fresh Bash call using a heredoc with a
   delimiter that won't appear in the content. Use `<<'EOF_SECTION'` so
   nothing inside is shell-expanded. Example:

   cat >> /tmp/dispatch.md <<'EOF_KEYFINDINGS'
   ## Key Findings

   - ...

   EOF_KEYFINDINGS

c. Sections in order: Key Findings → Background → Detailed Analysis
   (each ### subsection as its own append) → What's New → Open Questions
   → Sources. Drop any that genuinely has nothing.

d. After the last section is appended, continue to step 5.
```

Why this works:
- Each `cat >> … <<EOF_X … EOF_X` call is a short Bash tool invocation. Claude emits the section's text inside a heredoc and then stops — that's a discrete response.
- The idle-stream timeout is per-response. Short responses don't trip it.
- Between sections Claude can do a one-liner sanity check (`wc -w /tmp/dispatch.md`) if it wants, but doesn't have to.

## Shorter alternative — use the Write tool per section

If the routine environment exposes the `Write` tool, Claude can use it to overwrite `/tmp/dispatch.md.<n>` per section and `cat` them together at the end. The heredoc path above is preferred because it's one file throughout.
