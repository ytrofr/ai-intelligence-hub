const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { fetchJson, fetchText, fetchResponse, HttpError } = require("../modules/http");

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ hello: "world" }));
    } else if (req.url === "/text") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("plain body");
    } else if (req.url === "/slow") {
      setTimeout(() => {
        res.writeHead(200);
        res.end("late");
      }, 400);
    } else {
      res.writeHead(404);
      res.end("nope");
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

test("fetchJson returns parsed body on 200", async () => {
  const { server, base } = await startServer();
  try {
    const data = await fetchJson(`${base}/ok`, { timeoutMs: 1000 });
    assert.deepEqual(data, { hello: "world" });
  } finally {
    server.close();
  }
});

test("fetchText returns body on 200", async () => {
  const { server, base } = await startServer();
  try {
    assert.equal(await fetchText(`${base}/text`, { timeoutMs: 1000 }), "plain body");
  } finally {
    server.close();
  }
});

test("fetchJson throws HttpError with status on 404", async () => {
  const { server, base } = await startServer();
  try {
    await assert.rejects(fetchJson(`${base}/missing`, { timeoutMs: 1000 }), (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 404);
      assert.match(err.message, /404/);
      return true;
    });
  } finally {
    server.close();
  }
});

test("fetchText rejects with a timeout error when the server is slow", async () => {
  const { server, base } = await startServer();
  try {
    await assert.rejects(fetchText(`${base}/slow`, { timeoutMs: 50 }), (err) => {
      assert.equal(err.name, "TimeoutError");
      assert.match(err.message, /timed out/i);
      return true;
    });
  } finally {
    server.close();
  }
});

test("fetchJson rejects on connection refused (network down)", async () => {
  await assert.rejects(fetchJson("http://127.0.0.1:9/", { timeoutMs: 1000 }));
});

test("redirect:'manual' is forwarded, so a 3xx is visible instead of followed", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/moved") {
      res.writeHead(301, { Location: "/here" });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Without the pass-through, fetch follows the redirect and this is a 200.
    await assert.rejects(() => fetchResponse(`${base}/moved`, { redirect: "manual" }), (e) => e.status === 301);
    const followed = await fetchResponse(`${base}/moved`);
    assert.equal(followed.status, 200);
  } finally {
    server.close();
  }
});
