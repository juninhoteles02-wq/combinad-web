const assert = require("assert");
const g = require("../src/googleCalendar");
const h = [];
for (let i = 0; i < 10; i++) { h.push({ role: "user", content: "msg " + i + " " + "x".repeat(400) }); h.push({ role: "assistant", content: "resp " + i }); }
const p = g.empacotarHistorico(h);
assert(p.length >= 1 && p.length <= 5);
p.forEach((x) => assert(x.length <= 900));
const priv = { hist_n: String(p.length) }; p.forEach((x, i) => (priv["hist_" + i] = x));
const back = g.desempacotarHistorico(priv);
assert.strictEqual(back.length, 6);
assert.strictEqual(back[5].content, "resp 9");
assert.strictEqual(back[4].role, "user");
assert(back[4].content.length <= 160);
assert.deepStrictEqual(g.desempacotarHistorico({}), []);
assert.deepStrictEqual(g.desempacotarHistorico({ hist_n: "1", hist_0: "{quebrado" }), []);
console.log("historico-test OK");
