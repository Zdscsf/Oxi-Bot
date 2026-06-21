require("dotenv").config();

const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

// ===============================
// WEB SERVER (FIX RENDER LOOP)
// ===============================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Discord bot is running ✅");
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

// ===============================
// DISCORD CLIENT
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember, Partials.User]
});

// ===============================
// CONFIG
// ===============================
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;

const SAFE_ROLE_ID = process.env.SAFE_ROLE_ID;
const SUSPECT_ROLE_ID = process.env.SUSPECT_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const SCORE_THRESHOLD = Number(process.env.SCORE_THRESHOLD || 50);

// ===============================
// SCORE SYSTEM (UNCHANGED)
// ===============================
const SCORE_WEIGHTS = {
  startsWithExclamation: 25,
  accountLessThan7Days: 35,
  accountLessThan15Days: 25,
  accountLessThan30Days: 15,
  defaultAvatar: 25,
  noBio: 10,
  noServerTag: 10
};

const CHECKS = {
  checkNameStartsWithExclamation: true,
  checkAccountAge: true,
  checkDefaultAvatar: true,
  checkBio: false,
  checkServerTag: false
};

// ===============================
// UTILS
// ===============================
function daysSince(date) {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function isDefaultAvatar(user) {
  return user.avatar === null;
}

function getDisplayName(member) {
  return member.nickname || member.displayName || member.user.username;
}

function clampScore(score) {
  return Math.max(0, Math.min(100, score));
}

function buildReasonsText(reasons) {
  if (!reasons.length) return "No suspicious criteria matched.";
  return reasons.map(r => `• ${r}`).join("\n");
}

// ===============================
// SCORE CALCULATION (UNCHANGED)
// ===============================
async function calculateSuspicion(member) {
  const user = member.user;
  const reasons = [];
  let score = 0;

  if (CHECKS.checkNameStartsWithExclamation) {
    const name = getDisplayName(member);
    if (name.startsWith("!")) {
      score += SCORE_WEIGHTS.startsWithExclamation;
      reasons.push(`Display name starts with "!" (+${SCORE_WEIGHTS.startsWithExclamation})`);
    }
  }

  if (CHECKS.checkAccountAge) {
    const ageDays = daysSince(user.createdAt);

    if (ageDays < 7) {
      score += SCORE_WEIGHTS.accountLessThan7Days;
      reasons.push(`Account age < 7 days (+${SCORE_WEIGHTS.accountLessThan7Days})`);
    } else if (ageDays < 15) {
      score += SCORE_WEIGHTS.accountLessThan15Days;
      reasons.push(`Account age < 15 days (+${SCORE_WEIGHTS.accountLessThan15Days})`);
    } else if (ageDays < 30) {
      score += SCORE_WEIGHTS.accountLessThan30Days;
      reasons.push(`Account age < 30 days (+${SCORE_WEIGHTS.accountLessThan30Days})`);
    }
  }

  if (CHECKS.checkDefaultAvatar && isDefaultAvatar(user)) {
    score += SCORE_WEIGHTS.defaultAvatar;
    reasons.push(`Default avatar (+${SCORE_WEIGHTS.defaultAvatar})`);
  }

  if (CHECKS.checkBio) {
    const hasBio = true;
    if (!hasBio) {
      score += SCORE_WEIGHTS.noBio;
      reasons.push(`No bio (+${SCORE_WEIGHTS.noBio})`);
    }
  }

  if (CHECKS.checkServerTag) {
    const hasServerTag = true;
    if (!hasServerTag) {
      score += SCORE_WEIGHTS.noServerTag;
      reasons.push(`No server tag (+${SCORE_WEIGHTS.noServerTag})`);
    }
  }

  return {
    score: clampScore(score),
    reasons
  };
}

// ===============================
// FLAG SYSTEM (UNCHANGED)
// ===============================
async function flagMember(member, score, reasons) {
  const guild = member.guild;
  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);

  if (SAFE_ROLE_ID && member.roles.cache.has(SAFE_ROLE_ID)) {
    await member.roles.remove(SAFE_ROLE_ID).catch(console.error);
  }

  if (SUSPECT_ROLE_ID && !member.roles.cache.has(SUSPECT_ROLE_ID)) {
    await member.roles.add(SUSPECT_ROLE_ID).catch(console.error);
  }

  if (logChannel && logChannel.isTextBased()) {
    const msg =
`<@${member.id}>
🇫🇷 **Compte suspect détecté**
🇬🇧 **Suspicious account detected**

Score: ${score}/100

Reasons:
${buildReasonsText(reasons)}`;

    await logChannel.send({ content: msg }).catch(console.error);
  }
}

// ===============================
// SLASH COMMAND /ping
// ===============================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency")
    .toJSON()
];

async function registerCommands() {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Slash commands registered");
}

// ===============================
// EVENTS
// ===============================
client.once("ready", async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    const msg = await interaction.reply({
      content: "Pinging...",
      fetchReply: true
    });

    const latency = msg.createdTimestamp - interaction.createdTimestamp;

    await interaction.editReply(
      `🏓 Pong!\nLatency: ${latency}ms\nAPI: ${client.ws.ping}ms`
    );
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    if (GUILD_ID && member.guild.id !== GUILD_ID) return;

    const { score, reasons } = await calculateSuspicion(member);

    console.log(`[JOIN] ${member.user.tag} -> ${score}/100`);

    if (score >= SCORE_THRESHOLD) {
      await flagMember(member, score, reasons);
      console.log(`[FLAGGED] ${member.user.tag}`);
    }
  } catch (err) {
    console.error(err);
  }
});

// ===============================
// LOGIN
// ===============================
client.login(process.env.TOKEN);
