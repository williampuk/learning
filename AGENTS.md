# Interactive Learning

This repository is a static GitHub Pages site. The root `index.html` is the public directory of learning pages.

## Topic pages

- Keep each topic in its own top-level folder with a short, lowercase kebab-case name, such as `sorting-algorithms/`. The entry point is `<topic-slug>/index.html`.
- Look for an existing page on the same topic before creating a folder. Keep topic-specific assets and supporting files in that topic's folder.
- Use relative URLs for internal links and assets. The directory links to `./<topic-slug>/`, and each topic's entry page links back to `../`. This keeps navigation working under a GitHub Pages repository path.
- Give each page a descriptive title, one main heading, and a clear learning objective. Use semantic HTML and make interactive controls usable with a keyboard. Verify the page at desktop and mobile widths.
- Keep published pages usable on static hosting. If a topic uses a build step during development, its browser-ready entry point and assets must be available in the published folder.

## Teach for beginners

When creating or revising a topic, consider explanatory visuals, worked toy examples, and real-world examples. Choose the format and teaching aids based on the topic, what beginners are likely to find difficult, and the learning objective. Use existing pages as references. Adapt their ideas or invent new approaches when they would make the lesson clearer or give readers a better way to practice.

- Start with a concrete question or use case. State what the reader should already know, link to prerequisite lessons where available, and define new terms and symbols when they first appear. Build intuition before introducing formulas or implementation details, and explain why each important step works.
- When a toy example helps, carry one small, consistent example through the main ideas. Use inputs readers can work with by hand, show intermediate steps and expected results, and explain which assumptions or simplifications make it a toy example.
- Illustrate practical use where it helps the lesson with a verified example, public test vector, or runnable demo. If the lesson uses a toy example, connect its inputs, steps, and outputs to the real application and explain what changes in practice. Link to relevant primary sources and verify worked outputs and runnable examples.
- Choose visuals that reveal an important relationship or change, such as a labeled diagram, plot, table, or step-by-step trace. When experimenting helps, offer a working default, let readers vary a meaningful input, and show what changes and why. Provide a reset and a readable explanation or worked example that also works without JavaScript. Use clear labels and text cues alongside color.
- Help readers check their understanding with prediction prompts, small exercises, hints, worked answers, or examples of common mistakes. Keep the main path easy to follow and make deeper derivations, extended examples, and reference material available as optional reading.

See the exchange lab in the [ECDH guide](ecdh/index.html) for a step-by-step interactive example and the [Taproot guide](pay-to-taproot/index.html) for examples that carry through to real transactions.

## Maintain the directory

Update or verify the root `index.html` in the same change whenever you add, revise, rename, or remove a topic.

1. Read the existing category headings and choose the best fit based on what the reader will learn. Give each topic one primary listing.
2. Create a category only when the existing headings do not cover the subject. Use a concise, reusable name and a unique kebab-case heading ID. Add categories as needed. Possible starting points include **Computer Science**, **Mathematics**, and **Web Development**.
3. Copy the commented markup in `index.html` for a new category, or add an item to an existing category's list. Use the page title as link text and write one short sentence describing what the reader can learn or try.
4. Keep category headings and the topics within each category in alphabetical order. Update links and descriptions when they change. Remove a category section if it has no topics left. The empty-state message appears automatically when there are no category sections.
5. Verify that the directory link opens the topic, its return link opens the directory, and referenced assets load from their relative paths. Preview through a static HTTP server and include the repository path prefix when checking links.

