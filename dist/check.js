import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';
dotenv.config();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const GROUP_ID = 165491;
// Add caching to reduce API calls
const userCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
// Initialize axios instance with common config
const robloxAPI = axios.create({
    timeout: 5000,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }
});
// Command registration
const commands = [
    new SlashCommandBuilder()
        .setName('check')
        .setDescription('Check a Roblox user for badges, group join date, and account age.')
        .addStringOption(option => option.setName('username')
        .setDescription('Roblox Username or User ID')
        .setRequired(true))
].map(command => command.toJSON());
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
// Error handler utility
const handleApiError = (error, context) => {
    if (error instanceof AxiosError) {
        console.error(`${context} - Status: ${error.response?.status}, Message: ${error.message}`);
    }
    else {
        console.error(`${context}:`, error);
    }
    return null;
};
async function getRobloxUserId(username) {
    // Check cache first
    const cached = userCache.get(username);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    try {
        const response = await robloxAPI.post('https://users.roblox.com/v1/usernames/users', {
            usernames: [username],
            excludeBannedUsers: false
        });
        const userId = response.data.data[0]?.id ?? null;
        if (userId) {
            userCache.set(username, { data: userId, timestamp: Date.now() });
        }
        return userId;
    }
    catch (error) {
        return handleApiError(error, 'Error fetching user ID');
    }
}
// Update these functions for accurate data retrieval
async function getAccountAge(userId) {
    try {
        const response = await robloxAPI.get(`https://users.roblox.com/v1/users/${userId}`);
        const createdDate = new Date(response.data.created);
        const ageInDays = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
        return Math.max(0, ageInDays); // Ensure non-negative age
    }
    catch (error) {
        handleApiError(error, 'Error fetching account age');
        return 0;
    }
}
async function getUserBadges(userId) {
    try {
        let allBadges = [];
        let cursor = '';
        const limit = 100;
        do {
            const url = `https://badges.roblox.com/v1/users/${userId}/badges?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
            const response = await robloxAPI.get(url);
            allBadges = [...allBadges, ...response.data.data];
            cursor = response.data.nextPageCursor || '';
        } while (cursor);
        return allBadges;
    }
    catch (error) {
        handleApiError(error, 'Error fetching badges');
        return [];
    }
}
async function getGroupJoinDate(userId, groupId) {
    try {
        const response = await robloxAPI.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
        const group = response.data.data.find(g => g.group.id === groupId);
        if (!group)
            return null;
        // Ensure we have a valid date string
        if (!group.joined)
            return null;
        // Parse the date and validate it
        const joinDate = new Date(group.joined);
        return isNaN(joinDate.getTime()) ? null : joinDate;
    }
    catch (error) {
        handleApiError(error, 'Error fetching group join date');
        return null;
    }
}
async function getUserThumbnail(userId) {
    try {
        const response = await robloxAPI.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`);
        return response.data.data[0]?.imageUrl || '';
    }
    catch (error) {
        handleApiError(error, 'Error fetching user thumbnail');
        return '';
    }
}
async function getFriendCount(userId) {
    try {
        const response = await robloxAPI.get(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
        return response.data.count;
    }
    catch (error) {
        handleApiError(error, 'Error fetching friend count');
        return 0;
    }
}
// Modify calculateAltLikelihood function parameters and logic
function calculateAltLikelihood(accountAge, badgeCount, friendCount) {
    const reasons = [];
    let score = 0;
    let confidenceScore = 0;
    // Account age scoring (max 50 points)
    if (accountAge < 7) {
        score += 50;
        confidenceScore += 40;
        reasons.push("🚨 Account created less than a week ago");
    }
    else if (accountAge < 30) {
        score += 40;
        confidenceScore += 30;
        reasons.push("⚠️ Account less than a month old");
    }
    else if (accountAge < 90) {
        score += 25;
        confidenceScore += 20;
        reasons.push("📅 Account less than 3 months old");
    }
    else if (accountAge < 180) {
        score += 10;
        confidenceScore += 10;
        reasons.push("ℹ️ Account less than 6 months old");
    }
    // Badge count scoring (max 50 points)
    if (badgeCount === 0) {
        score += 50;
        confidenceScore += 40;
        reasons.push("🚨 No badges earned");
    }
    else if (badgeCount < 5) {
        score += 35;
        confidenceScore += 30;
        reasons.push("⚠️ Very few badges (<5)");
    }
    else if (badgeCount < 15) {
        score += 20;
        confidenceScore += 20;
        reasons.push("📊 Low badge count (<15)");
    }
    else if (badgeCount < 25) {
        score += 10;
        confidenceScore += 10;
        reasons.push("ℹ️ Moderate badge count (<25)");
    }
    // Friend count scoring (max 25 points)
    if (friendCount === 0) {
        score += 25;
        confidenceScore += 25;
        reasons.push("🚫 No friends added");
    }
    else if (friendCount < 5) {
        score += 20;
        confidenceScore += 20;
        reasons.push("👥 Very few friends (<5)");
    }
    else if (friendCount < 10) {
        score += 10;
        confidenceScore += 10;
        reasons.push("👥 Low friend count (<10)");
    }
    const finalScore = Math.min(100, score);
    let severity = 'LOW';
    if (finalScore > 75)
        severity = 'HIGH';
    else if (finalScore > 40)
        severity = 'MEDIUM';
    return {
        score: finalScore,
        reasons,
        severity,
        confidence: Math.min(100, confidenceScore)
    };
}
// Modify the Promise.all and related code in handleCheckCommand
async function handleCheckCommand(interaction) {
    try {
        await interaction.deferReply();
        const username = interaction.options.get('username')?.value;
        const userId = await getRobloxUserId(username);
        if (!userId) {
            return interaction.editReply('❌ Could not find the specified Roblox user.');
        }
        const [accountAge, badges, thumbnail, friendCount] = await Promise.all([
            getAccountAge(userId),
            getUserBadges(userId),
            getUserThumbnail(userId),
            getFriendCount(userId)
        ]);
        const altAnalysis = calculateAltLikelihood(accountAge, badges.length, friendCount);
        const getSeverityEmoji = (severity) => {
            switch (severity) {
                case 'HIGH': return '🔴';
                case 'MEDIUM': return '🟡';
                default: return '🟢';
            }
        };
        return interaction.editReply({
            embeds: [{
                    title: `${getSeverityEmoji(altAnalysis.severity)} Roblox User Analysis`,
                    author: {
                        name: username,
                        url: `https://www.roblox.com/users/${userId}/profile`,
                        icon_url: thumbnail
                    },
                    thumbnail: {
                        url: thumbnail
                    },
                    fields: [
                        { name: '👤 User ID', value: userId.toString(), inline: true },
                        { name: '📅 Account Age', value: `${accountAge.toLocaleString()} days`, inline: true },
                        { name: '🏅 Badges', value: `${badges.length.toLocaleString()}`, inline: true },
                        { name: '👥 Friends', value: `${friendCount.toLocaleString()}`, inline: true },
                        { name: '⚠️ Alt Score', value: `${altAnalysis.score}% (${altAnalysis.confidence}% confidence)`, inline: false },
                        { name: '📝 Analysis', value: altAnalysis.reasons.join('\n') || '✅ No suspicious patterns detected', inline: false }
                    ],
                    color: altAnalysis.score > 75 ? 0xFF0000 : altAnalysis.score > 40 ? 0xFFA500 : 0x00FF00,
                    footer: { text: `Confidence Level: ${altAnalysis.confidence}%` },
                    timestamp: new Date().toISOString(),
                    url: `https://www.roblox.com/users/${userId}/profile`
                }]
        });
    }
    catch (error) {
        console.error('Command execution error:', error);
        return interaction.editReply('❌ An error occurred while processing your request.');
    }
}
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand())
        return;
    if (interaction.commandName === 'check') {
        await handleCheckCommand(interaction);
    }
});
client.once('ready', async () => {
    try {
        console.log(`✅ Logged in as ${client.user?.tag}`);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Slash commands registered.');
    }
    catch (error) {
        console.error('❌ Startup error:', error);
    }
});
client.login(process.env.TOKEN);
