# Interactive Learning

This repository is a static GitHub Pages site. The root `index.html` is the public directory of learning pages.

## Topic pages

- Keep each topic in its own top-level folder with a short, lowercase kebab-case name, such as `sorting-algorithms/`. The entry point is `<topic-slug>/index.html`.
- Look for an existing page on the same topic before creating a folder. Keep topic-specific assets and supporting files in that topic's folder.
- Use relative URLs for internal links and assets. The directory links to `./<topic-slug>/`, and each topic's entry page links back to `../`. This keeps navigation working under a GitHub Pages repository path.
- Give each page a descriptive title, one main heading, and a clear learning objective. Use semantic HTML and make interactive controls usable with a keyboard. Verify the page at desktop and mobile widths.
- Keep published pages usable on static hosting. If a topic uses a build step during development, its browser-ready entry point and assets must be available in the published folder.

## Maintain the directory

Update or verify the root `index.html` in the same change whenever you add, revise, rename, or remove a topic.

1. Read the existing category headings and choose the best fit based on what the reader will learn. Give each topic one primary listing.
2. Create a category only when the existing headings do not cover the subject. Use a concise, reusable name and a unique kebab-case heading ID. Add categories as needed. Possible starting points include **Computer Science**, **Mathematics**, and **Web Development**.
3. Copy the commented markup in `index.html` for a new category, or add an item to an existing category's list. Use the page title as link text and write one short sentence describing what the reader can learn or try.
4. Keep category headings and the topics within each category in alphabetical order. Update links and descriptions when they change. Remove a category section if it has no topics left. The empty-state message appears automatically when there are no category sections.
5. Verify that the directory link opens the topic, its return link opens the directory, and referenced assets load from their relative paths. Preview through a static HTTP server and include the repository path prefix when checking links.

