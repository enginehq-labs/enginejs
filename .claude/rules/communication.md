## Communication style

Write all communication in ASD-STE-100 Simplified Technical English (STE).
This rule applies to every channel. The channel list includes:

- chat replies in the terminal or the desktop app
- commit messages and pull request descriptions
- GitHub issues, issue comments, and code review comments
- code comments and documentation
- log messages and error messages

### STE writing rules

Follow these rules:

1. Write short sentences. Use a maximum of 20 words in a procedure sentence.
   Use a maximum of 25 words in a descriptive sentence.
2. Write one instruction in one sentence.
3. Use the active voice. Write "the runner claims the event".
   Do not write "the event is claimed by the runner".
4. Use simple verb tenses. Use the simple present, the simple past,
   or the simple future.
5. Do not use the -ing form of a verb when a simple form is possible.
6. Use articles such as "the" and "a" where possible.
7. Use the same word for the same idea. Do not use synonyms for variety.
8. Use a maximum of 6 sentences in a descriptive paragraph.
   Use a maximum of 3 sentences in a procedure paragraph.
9. Use a vertical list for complex information.
10. Do not use slang, idioms, or jargon.
11. Write a positive instruction. Do not write a negative instruction
    when a positive one is possible.

### Forbidden characters

Do not use these characters. They identify AI-generated text:

| Forbidden | Name | Use this instead |
|---|---|---|
| `—` | em dash | a comma, a colon, parentheses, or two sentences |
| `–` | en dash | the word "to" for a range, or a hyphen |
| `…` | ellipsis character | three full stops, or remove it |
| `“` `”` | curly double quotes | straight quotes `"` |
| `‘` `’` | curly single quotes | straight quotes `'` |
| `•` | bullet character | a Markdown list with `-` |
| ` ` | non-breaking space | a normal space |

The ASCII hyphen `-` is correct. Use it for compound words and for Markdown lists.

Examples of correct replacement:

- Not allowed: `The build failed — the dist folder was empty.`
- Allowed: `The build failed because the dist folder was empty.`
- Not allowed: `Phases 0–5 are complete.`
- Allowed: `Phases 0 to 5 are complete.`

### Forbidden phrases

Do not use filler phrases that identify AI-generated text. Examples:

- "delve into", "dive into"
- "it is not just X, it is Y"
- "seamless", "robust", "leverage" as a verb, "elevate"
- "In conclusion", "Furthermore", "Moreover" as a paragraph start
- "I hope this helps"

Write the fact instead.

### How to check your text

Run this command before you send a message or commit text:

```bash
grep -nP '[\x{2013}\x{2014}\x{2018}\x{2019}\x{201c}\x{201d}\x{2026}\x{2022}\x{00a0}]' <file>
```

The command gives no output when the text is correct.
