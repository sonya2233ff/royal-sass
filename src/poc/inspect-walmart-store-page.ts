/** Inspect /en/store/5831 HTML: real store page vs PX block */
async function main() {
  const res = await fetch("https://www.walmart.ca/en/store/5831", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
  });
  const html = await res.text();
  console.log({
    status: res.status,
    url: res.url,
    len: html.length,
    title: html.match(/<title>([^<]*)<\/title>/i)?.[1],
    isBlockedPage: /Verify Your Identity/i.test(html),
    hasNext: html.includes("__NEXT_DATA__"),
    hasCentre: /Centre St|Thornhill|5831/i.test(html),
  });

  const next = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!next) {
    console.log("no NEXT_DATA");
    return;
  }
  const data = JSON.parse(next[1]);
  const s = JSON.stringify(data);
  console.log("next top keys", Object.keys(data));
  console.log("props keys", data.props ? Object.keys(data.props) : null);
  console.log(
    "pageProps keys",
    data.props?.pageProps ? Object.keys(data.props.pageProps) : null,
  );

  // Find store-ish objects with 5831
  const hits: string[] = [];
  const re = /"([^"]*(?:store|address|postal|displayName|nodeId)[^"]*)"\s*:\s*("(?:\\.|[^"\\])*"|[0-9.]+|true|false)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) && hits.length < 40) {
    if (/5831|Centre|Thornhill|L4J/i.test(m[0])) hits.push(m[0].slice(0, 200));
  }
  console.log("field hits", hits);

  // Save a small extract of initialData if present
  const initial =
    data.props?.pageProps?.initialData ??
    data.props?.pageProps?.store ??
    data.props?.pageProps;
  console.log(
    "initial snippet",
    JSON.stringify(initial, null, 2)?.slice(0, 2000),
  );
}

main();
