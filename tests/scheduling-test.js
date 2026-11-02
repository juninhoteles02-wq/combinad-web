// Testes das regras puras de agenda (almoço, duração, dia fechado, passado, conflito).
process.env.ELIAS_PHONE_NUMBER_ID = "PN";
process.env.ELIAS_CALENDAR_ID = "cal";
const assert = require("assert");
const { getClientById } = require("../src/config");
const s = require("../src/scheduling");
const c = getClientById("elias");
const H = c.businessHours;
const SV = c.services;

// um dia útil futuro (terça a sábado) e um domingo/segunda futuros
const futuro = (dow) => { const d = new Date(); d.setDate(d.getDate() + 7); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); return s.isoFromDate ? s.isoFromDate(d) : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const terca = futuro(2), domingo = futuro(0), segunda = futuro(1);

// dias
assert(s.isOpenDay(terca, H));
assert(!s.isOpenDay(domingo, H));
assert(!s.isOpenDay(segunda, H));
assert.throws(() => s.checkDay(domingo, H), /não abre/);
assert.throws(() => s.checkDay("amanhã", H), /formato/);
assert.throws(() => s.checkDay("2020-01-07", H), /passou/);
assert.strictEqual(s.checkDay(terca, H), terca);

// almoço e grade
assert(s.isLunch("12:00", H) && s.isLunch("12:30", H));
assert(!s.isLunch("11:30", H) && !s.isLunch("13:00", H));
const grade = s.timesOfDay(H);
assert.strictEqual(grade[0], "09:00");
assert.strictEqual(grade[grade.length - 1], "18:30");

// cabe / não cabe (agenda vazia)
const fit = (hora, min, evs = [], ign) => s.canFit(terca, "Elias", hora, min, H, evs, ign, SV);
assert(fit("09:00", 30));
assert(fit("11:30", 30));
assert(!fit("12:00", 30), "almoço");
assert(!fit("11:30", 60), "60 min batendo no almoço");
assert(fit("13:00", 60));
assert(fit("18:00", 60));
assert(!fit("18:30", 60), "passa do fechamento");
assert(!fit("19:00", 30), "fora do expediente");
assert(!fit("08:30", 30), "antes de abrir");

// conflito, inclusive com serviço longo já marcado
const ev = (hora, servico, barbeiro = "Elias", situacao = "agendado") => ({ id: "E" + hora, hora, servico, barbeiro, situacao });
const ocupado = [ev("10:00", "Corte + Barba")]; // 10:00 e 10:30
assert(!fit("10:00", 30, ocupado));
assert(!fit("10:30", 30, ocupado));
assert(fit("11:00", 30, ocupado));
assert(!fit("09:30", 60, ocupado), "60 min invadindo o horário marcado");
assert(fit("09:00", 60, ocupado));
assert(fit("10:00", 30, ocupado, "E10:00"), "ignora o próprio evento ao remarcar");
assert(fit("10:00", 30, [ev("10:00", "Corte", "Outro")]), "outro barbeiro não conflita");
assert(fit("10:00", 30, [ev("10:00", "Corte", "Elias", "cancelado")]), "cancelado libera");

// passado: hoje
const hoje = s.isoToday();
assert(s.isPast(hoje, "00:00"));
assert(!s.isPast(terca, "00:00"));

// utilitários
assert.deepStrictEqual(s.timesOfDayFromHora("10:30", 3), ["10:30", "11:00", "11:30"]);
assert.strictEqual(s.br("2026-11-02"), "02/11");
const prox = s.nextOpenDays(H, 6);
assert.strictEqual(prox.length, 6);
prox.forEach((d) => assert(s.isOpenDay(d, H)));
console.log("scheduling-test OK");
