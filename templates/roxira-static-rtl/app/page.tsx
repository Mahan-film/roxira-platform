import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Article = { id: string; title: string; body: string };

function articles(): Article[] {
  const directory = join(process.cwd(), "content");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const [heading = "", ...body] = readFileSync(join(directory, name), "utf8").trim().split("\n");
      return { id: name, title: heading.replace(/^#\s*/, ""), body: body.join(" ").trim() };
    });
}

const filterScript = `
document.getElementById("search")?.addEventListener("input", (event) => {
  const query = event.currentTarget.value.trim().toLowerCase();
  document.querySelectorAll("[data-article]").forEach((article) => {
    article.hidden = !article.textContent.toLowerCase().includes(query);
  });
});
`;

export default function Home() {
  return (
    <main>
      <h1>مقالات روکسیر</h1>
      <label>
        جست‌وجو
        <input id="search" type="search" aria-label="جست‌وجو" placeholder="جست‌وجو در مقالات" />
      </label>
      <ul>
        {articles().map((article) => (
          <li key={article.id} data-article>
            <h2>{article.title}</h2>
            <p>{article.body}</p>
          </li>
        ))}
      </ul>
      <script dangerouslySetInnerHTML={{ __html: filterScript }} />
    </main>
  );
}
