// ── CALCIONETTO — API-Football Real Data ──
// Vercel Edge Function: /api/football
// Dati reali: partite, formazioni, infortuni, quote, xG

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY; // 1644e91c51a318ddd1dd091b5d364fa3
const FOOTBALL_API_HOST = 'v3.football.api-sports.io';

// Cache in memoria (resettata al riavvio — OK per edge functions)
const cache = {};

function cacheKey(endpoint, params) {
  return endpoint + JSON.stringify(params);
}

function cacheGet(key, maxAgeMinutes = 60) {
  const item = cache[key];
  if (!item) return null;
  if (Date.now() - item.ts > maxAgeMinutes * 60 * 1000) return null;
  return item.data;
}

function cacheSet(key, data) {
  cache[key] = { data, ts: Date.now() };
}

// ── Chiama API-Football ──
async function callFootballAPI(endpoint, params = {}) {
  const ck = cacheKey(endpoint, params);
  const cached = cacheGet(ck, endpoint === 'fixtures' ? 30 : 60);
  if (cached) return cached;

  const url = new URL(`https://${FOOTBALL_API_HOST}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'x-rapidapi-key': FOOTBALL_API_KEY,
      'x-rapidapi-host': FOOTBALL_API_HOST,
    }
  });

  if (!res.ok) throw new Error(`API-Football error: ${res.status}`);
  const data = await res.json();
  cacheSet(ck, data);
  return data;
}

// ── Leghe monitorate ──
const LEAGUES = {
  serie_a: { id: 135, country: 'Italy', name: 'Serie A' },
  champions: { id: 2, country: 'Europe', name: 'Champions League' },
  premier: { id: 39, country: 'England', name: 'Premier League' },
  laliga: { id: 140, country: 'Spain', name: 'La Liga' },
  europa: { id: 3, country: 'Europe', name: 'Europa League' },
};

const SEASON = 2024;

// ── Ottieni partite di oggi e domani ──
async function getFixtures() {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const [todayData, tomorrowData] = await Promise.all([
    callFootballAPI('fixtures', { date: today, timezone: 'Europe/Rome' }),
    callFootballAPI('fixtures', { date: tomorrow, timezone: 'Europe/Rome' }),
  ]);

  const leagueIds = Object.values(LEAGUES).map(l => l.id);
  const filterFixtures = (data) => (data?.response || []).filter(f =>
    leagueIds.includes(f.league.id)
  );

  const todayFixtures = filterFixtures(todayData);
  const tomorrowFixtures = filterFixtures(tomorrowData);

  return { today: todayFixtures, tomorrow: tomorrowFixtures };
}

// ── Probabili formazioni per una partita ──
async function getLineups(fixtureId) {
  const data = await callFootballAPI('fixtures/lineups', { fixture: fixtureId });
  return data?.response || [];
}

// ── Infortuni della settimana ──
async function getInjuries(leagueId) {
  const data = await callFootballAPI('injuries', {
    league: leagueId,
    season: SEASON,
  });
  return data?.response || [];
}

// ── Statistiche giocatore ──
async function getPlayerStats(playerId) {
  const data = await callFootballAPI('players', {
    id: playerId,
    season: SEASON,
    league: 135,
  });
  return data?.response?.[0] || null;
}

// ── Classifica Serie A ──
async function getStandings() {
  const data = await callFootballAPI('standings', {
    league: 135,
    season: SEASON,
  });
  return data?.response?.[0]?.league?.standings?.[0] || [];
}

// ── Quote partita ──
async function getOdds(fixtureId) {
  const data = await callFootballAPI('odds', {
    fixture: fixtureId,
    bookmaker: 8, // Bet365
  });
  return data?.response?.[0] || null;
}

// ── Statistiche partita (xG, tiri, ecc.) ──
async function getFixtureStats(fixtureId) {
  const data = await callFootballAPI('fixtures/statistics', {
    fixture: fixtureId,
  });
  return data?.response || [];
}

// ── Formatta fixture per il frontend ──
function formatFixture(f) {
  const kickoff = new Date(f.fixture.date);
  const now = new Date();
  const diffMs = kickoff - now;
  const diffMin = Math.round(diffMs / 60000);

  let status = 'pending';
  if (f.fixture.status.short === 'FT') status = 'finished';
  else if (['1H','2H','HT','ET','BT','P'].includes(f.fixture.status.short)) status = 'live';
  else if (diffMin < 0 && status !== 'finished') status = 'live';

  return {
    id: f.fixture.id,
    date: f.fixture.date,
    kickoff: kickoff.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    status,
    elapsed: f.fixture.status.elapsed,
    league: { id: f.league.id, name: f.league.name, logo: f.league.logo },
    home: {
      id: f.teams.home.id,
      name: f.teams.home.name,
      logo: f.teams.home.logo,
      score: f.goals.home,
    },
    away: {
      id: f.teams.away.id,
      name: f.teams.away.name,
      logo: f.teams.away.logo,
      score: f.goals.away,
    },
  };
}

// ── HANDLER PRINCIPALE ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { type, fixture_id, league } = req.query;

  try {
    switch (type) {

      // Partite oggi + domani
      case 'fixtures': {
        const data = await getFixtures();
        return res.status(200).json({
          ok: true,
          today: data.today.map(formatFixture),
          tomorrow: data.tomorrow.map(formatFixture),
          updatedAt: new Date().toISOString(),
        });
      }

      // Probabili formazioni — aggiornate automaticamente quando disponibili
      case 'lineups': {
        if (!fixture_id) return res.status(400).json({ error: 'fixture_id required' });
        const lineups = await getLineups(fixture_id);

        // Se le formazioni non sono ancora disponibili, ritorna array vuoto
        const hasLineups = lineups.length > 0 && lineups[0]?.startXI?.length > 0;

        return res.status(200).json({
          ok: true,
          available: hasLineups,
          lineups: hasLineups ? lineups.map(team => ({
            team: { id: team.team.id, name: team.team.name },
            formation: team.formation,
            coach: team.coach?.name,
            startXI: (team.startXI || []).map(p => ({
              id: p.player.id,
              name: p.player.name,
              number: p.player.number,
              pos: p.player.pos,
              grid: p.player.grid,
            })),
            substitutes: (team.substitutes || []).map(p => ({
              id: p.player.id,
              name: p.player.name,
              pos: p.player.pos,
            })),
          })) : [],
          updatedAt: new Date().toISOString(),
        });
      }

      // Infortuni per lega
      case 'injuries': {
        const leagueId = league ? parseInt(league) : 135;
        const injuries = await getInjuries(leagueId);
        return res.status(200).json({
          ok: true,
          injuries: injuries.map(i => ({
            player: { id: i.player.id, name: i.player.name, photo: i.player.photo },
            team: { id: i.team.id, name: i.team.name },
            fixture: i.fixture?.date,
            type: i.player.type,
            reason: i.player.reason,
          })),
          updatedAt: new Date().toISOString(),
        });
      }

      // Quote
      case 'odds': {
        if (!fixture_id) return res.status(400).json({ error: 'fixture_id required' });
        const odds = await getOdds(fixture_id);
        if (!odds) return res.status(200).json({ ok: true, odds: null });

        // Estrai 1X2
        const bet = odds.bookmakers?.[0]?.bets?.find(b => b.name === 'Match Winner');
        const over25 = odds.bookmakers?.[0]?.bets?.find(b => b.name === 'Goals Over/Under')
          ?.values?.find(v => v.value === 'Over 2.5');
        const gg = odds.bookmakers?.[0]?.bets?.find(b => b.name === 'Both Teams Score')
          ?.values?.find(v => v.value === 'Yes');

        return res.status(200).json({
          ok: true,
          odds: {
            home: bet?.values?.find(v => v.value === 'Home')?.odd,
            draw: bet?.values?.find(v => v.value === 'Draw')?.odd,
            away: bet?.values?.find(v => v.value === 'Away')?.odd,
            over25: over25?.odd,
            gg: gg?.odd,
          },
        });
      }

      // Statistiche partita (xG, tiri, ecc.)
      case 'stats': {
        if (!fixture_id) return res.status(400).json({ error: 'fixture_id required' });
        const stats = await getFixtureStats(fixture_id);
        return res.status(200).json({ ok: true, stats });
      }

      // Classifica
      case 'standings': {
        const standings = await getStandings();
        return res.status(200).json({
          ok: true,
          standings: standings.map(t => ({
            rank: t.rank,
            team: { id: t.team.id, name: t.team.name },
            points: t.points,
            played: t.all.played,
            wins: t.all.win,
            draws: t.all.draw,
            losses: t.all.lose,
            gf: t.all.goals.for,
            ga: t.all.goals.against,
            gd: t.goalsDiff,
          })),
        });
      }

      default:
        return res.status(400).json({ error: 'type non valido. Usa: fixtures, lineups, injuries, odds, stats, standings' });
    }
  } catch (err) {
    console.error('Football API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
