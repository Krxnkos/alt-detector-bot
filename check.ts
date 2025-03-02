import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, CommandInteraction } from 'discord.js';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';
import { RobloxUser, RobloxBadge, RobloxGroupResponse } from './types.js';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const GROUP_ID = 165491;

// Add caching to reduce API calls
const userCache = new Map<string, { data: number; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Initialize axios instance with common config
const robloxAPI = axios.create({
    timeout: 5000,
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Alt-Account-Checker/1.0'
    }
});

// Command registration
const commands = [
    new SlashCommandBuilder()
        .setName('check')
        .setDescription('Check a Roblox user for badges, group join date, and account age.')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Roblox Username or User ID')
                .setRequired(true)
        )
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN!);

// Error handler utility
const handleApiError = (error: unknown, context: string): null => {
    if (error instanceof AxiosError) {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.message;
        console.error(`${context} - Status: ${status}, Message: ${message}`);
        
        // Log additional details for debugging
        if (error.config) {
            console.error('Request URL:', error.config.url);
            console.error('Request Method:', error.config.method);
        }
    } else {
        console.error(`${context}:`, error);
    }
    return null;
};

async function getRobloxUserId(username: string): Promise<number | null> {
    // Check cache first
    const cached = userCache.get(username);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }

    try {
        const response = await robloxAPI.post<{ data: RobloxUser[] }>('https://users.roblox.com/v1/usernames/users', {
            usernames: [username],
            excludeBannedUsers: false
        });

        const userId = response.data.data[0]?.id ?? null;
        if (userId) {
            userCache.set(username, { data: userId, timestamp: Date.now() });
        }
        return userId;
    } catch (error) {
        return handleApiError(error, 'Error fetching user ID');
    }
}

// Update these functions for accurate data retrieval

async function getAccountAge(userId: number): Promise<number> {
    try {
        const response = await robloxAPI.get<RobloxUser>(`https://users.roblox.com/v1/users/${userId}`);
        const createdDate = new Date(response.data.created);
        const ageInDays = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
        return Math.max(0, ageInDays); // Ensure non-negative age
    } catch (error) {
        handleApiError(error, 'Error fetching account age');
        return 0;
    }
}

async function getUserBadges(userId: number): Promise<RobloxBadge[]> {
    try {
        let allBadges: RobloxBadge[] = [];
        let cursor = '';
        const limit = 100;

        do {
            const url = `https://badges.roblox.com/v1/users/${userId}/badges?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
            const response = await robloxAPI.get<{
                previousPageCursor: string | null;
                nextPageCursor: string | null;
                data: RobloxBadge[];
            }>(url);

            allBadges = [...allBadges, ...response.data.data];
            cursor = response.data.nextPageCursor || '';
        } while (cursor);

        return allBadges;
    } catch (error) {
        handleApiError(error, 'Error fetching badges');
        return [];
    }
}

async function getGroupJoinDate(userId: number, groupId: number): Promise<Date | null> {
    try {
        const response = await robloxAPI.get<RobloxGroupResponse>(
            `https://groups.roblox.com/v1/users/${userId}/groups/roles`
        );

        const group = response.data.data.find(g => g.group.id === groupId);
        if (!group) return null;

        // Ensure we have a valid date string
        if (!group.joined) return null;

        // Parse the date and validate it
        const joinDate = new Date(group.joined);
        return isNaN(joinDate.getTime()) ? null : joinDate;
    } catch (error) {
        handleApiError(error, 'Error fetching group join date');
        return null;
    }
}

interface RobloxThumbnail {
    data: [{
        state: string;
        imageUrl: string;
    }];
}

async function getUserThumbnail(userId: number): Promise<string> {
    try {
        const response = await robloxAPI.get<RobloxThumbnail>(
            `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png`
        );
        return response.data.data[0]?.imageUrl || '';
    } catch (error) {
        handleApiError(error, 'Error fetching user thumbnail');
        return '';
    }
}

interface RobloxFriendCount {
    count: number;
}

async function getFriendCount(userId: number): Promise<number> {
    try {
        const response = await robloxAPI.get<RobloxFriendCount>(
            `https://friends.roblox.com/v1/users/${userId}/friends/count`
        );
        return response.data.count;
    } catch (error) {
        handleApiError(error, 'Error fetching friend count');
        return 0;
    }
}

interface AltScore {
    score: number;
    reasons: string[];
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    confidence: number;
}

// Update the RobloxBadgeWithAward interface
interface RobloxBadgeWithAward {
    awardedDate: string;
    badgeId: number;
    id: number;
    name: string;
}

// Add this function to analyze badge patterns
async function analyzeBadgePattern(userId: number): Promise<{
    badgeCount: number;
    recentBadges: number;
    badgesPerMonth: number;
}> {
    try {
        const response = await robloxAPI.get<{ data: RobloxBadgeWithAward[] }>(
            `https://badges.roblox.com/v1/users/${userId}/badges`
        );

        const badges = response.data.data;
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

        // Get recent badges
        const recentBadges = badges.filter(badge => {
            const awardDate = new Date(badge.awardedDate);
            return !isNaN(awardDate.getTime()) && awardDate > thirtyDaysAgo;
        }).length;

        // Calculate badges per month more reliably
        if (badges.length === 0) {
            return {
                badgeCount: 0,
                recentBadges: 0,
                badgesPerMonth: 0
            };
        }

        const validDates = badges
            .map(badge => new Date(badge.awardedDate))
            .filter(date => !isNaN(date.getTime()));

        if (validDates.length === 0) {
            return {
                badgeCount: badges.length,
                recentBadges,
                badgesPerMonth: 0
            };
        }

        const oldestBadgeDate = new Date(Math.min(...validDates.map(d => d.getTime())));
        const monthsSinceFirstBadge = Math.max(
            1,
            (now.getTime() - oldestBadgeDate.getTime()) / (30 * 24 * 60 * 60 * 1000)
        );

        return {
            badgeCount: badges.length,
            recentBadges,
            badgesPerMonth: Math.round((badges.length / monthsSinceFirstBadge) * 100) / 100
        };
    } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 404) {
            console.error('User badges not found or API endpoint changed');
            return { badgeCount: 0, recentBadges: 0, badgesPerMonth: 0 };
        }
        handleApiError(error, 'Error analyzing badge pattern');
        return { badgeCount: 0, recentBadges: 0, badgesPerMonth: 0 };
    }
}

// Add this interface after other interfaces
interface RobloxAvatarData {
    scales: {
        height: number;
        width: number;
        head: number;
        depth: number;
        proportion: number;
        bodyType: number;
    };
    playerAvatarType: string;
    emotes: any[];
    assets: any[];
    defaultShirtApplied: boolean;
    defaultPantsApplied: boolean;
}

// Modify calculateAltLikelihood function parameters and logic
function calculateAltLikelihood(
    username: string,
    accountAge: number,
    badgeAnalysis: { badgeCount: number; recentBadges: number; badgesPerMonth: number },
    friendCount: number
): AltScore {
    const reasons: string[] = [];
    let score = 0;
    let confidenceScore = 0;

    // Username check (max 25 points)
    if (username.toLowerCase().includes('alt')) {
        score += 25;
        confidenceScore += 25;
        reasons.push("🚨 Username contains 'alt'");
    }

    // Account age scoring (max 35 points)
    if (accountAge < 7) {
        score += 35;
        confidenceScore += 35;
        reasons.push("🚨 Account created less than a week ago");
    } else if (accountAge < 30) {
        score += 25;
        confidenceScore += 25;
        reasons.push("⚠️ Account less than a month old");
    } else if (accountAge < 90) {
        score += 15;
        confidenceScore += 15;
        reasons.push("📅 Account less than 3 months old");
    }

    // Badge pattern scoring (max 25 points)
    if (badgeAnalysis.badgeCount === 0) {
        if (accountAge > 30) {
            score += 25;
            confidenceScore += 25;
            reasons.push("🚨 No badges earned despite account age");
        } else {
            score += 15;
            confidenceScore += 15;
            reasons.push("⚠️ No badges earned (new account)");
        }
    } else {
        if (badgeAnalysis.badgesPerMonth < 1) {
            score += 15;
            confidenceScore += 15;
            reasons.push("📊 Very low badge earning rate (<1 per month)");
        }
        if (badgeAnalysis.recentBadges === 0 && accountAge > 30) {
            score += 10;
            confidenceScore += 10;
            reasons.push("⚠️ No recent badge activity");
        }
    }

    // Friend count scoring (max 15 points)
    if (friendCount === 0) {
        score += 15;
        confidenceScore += 15;
        reasons.push("🚫 No friends added");
    } else if (friendCount < 5) {
        score += 10;
        confidenceScore += 10;
        reasons.push("👥 Very few friends (<5)");
    }

    const finalScore = Math.min(100, score);
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

    if (finalScore > 70) severity = 'HIGH';
    else if (finalScore > 35) severity = 'MEDIUM';

    return {
        score: finalScore,
        reasons,
        severity,
        confidence: Math.min(100, confidenceScore)
    };
}

// Add this function after getUserThumbnail
async function isDefaultAvatar(userId: number): Promise<boolean> {
    try {
        const response = await robloxAPI.get<RobloxAvatarData>(
            `https://avatar.roblox.com/v1/users/${userId}/avatar`
        );
        
        // More thorough default avatar checks
        const isDefaultOutfit = response.data.defaultShirtApplied && response.data.defaultPantsApplied;
        const hasNoAssets = response.data.assets.length === 0;
        const hasDefaultScales = Object.values(response.data.scales).every(scale => 
            Math.abs(scale - 1.0) < 0.01  // Allow for small floating point differences
        );
        
        // Consider it default if either condition is true
        return (isDefaultOutfit && hasDefaultScales) || hasNoAssets;
    } catch (error) {
        handleApiError(error, 'Error checking avatar status');
        return false;
    }
}

// Modify the Promise.all and related code in handleCheckCommand
async function handleCheckCommand(interaction: CommandInteraction) {
    try {
        await interaction.deferReply();
        const username = interaction.options.get('username')?.value as string;

        const userId = await getRobloxUserId(username);
        if (!userId) {
            return interaction.editReply('❌ Could not find the specified Roblox user.');
        }

        const [accountAge, badgeAnalysis, thumbnail, friendCount] = await Promise.all([
            getAccountAge(userId),
            analyzeBadgePattern(userId),
            getUserThumbnail(userId),
            getFriendCount(userId)
        ]);

        const altAnalysis = calculateAltLikelihood(username, accountAge, badgeAnalysis, friendCount);

        const getSeverityEmoji = (severity: string) => {
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
                    { name: '🏅 Badges', value: `${badgeAnalysis.badgeCount.toLocaleString()} (${badgeAnalysis.badgesPerMonth}/month)`, inline: true },
                    { name: '👥 Friends', value: `${friendCount.toLocaleString()}`, inline: true },
                    { name: '📈 Recent Activity', value: `${badgeAnalysis.recentBadges} badges in 30 days`, inline: true },
                    { name: '⚠️ Alt Score', value: `${altAnalysis.score}% (${altAnalysis.confidence}% confidence)`, inline: false },
                    { name: '📝 Analysis', value: altAnalysis.reasons.join('\n') || '✅ No suspicious patterns detected', inline: false }
                ],
                color: altAnalysis.score > 75 ? 0xFF0000 : altAnalysis.score > 40 ? 0xFFA500 : 0x00FF00,
                footer: { 
                    text: `Bot made by Krxnkos • Confidence Level: ${altAnalysis.confidence}%`
                },
                timestamp: new Date().toISOString(),
                url: `https://www.roblox.com/users/${userId}/profile`
            }]
        });
    } catch (error) {
        console.error('Command execution error:', error);
        return interaction.editReply('❌ An error occurred while processing your request.');
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    if (interaction.commandName === 'check') {
        await handleCheckCommand(interaction);
    }
});

client.once('ready', async () => {
    try {
        console.log(`✅ Logged in as ${client.user?.tag}`);
        await rest.put(Routes.applicationCommands(client.user!.id), { body: commands });
        console.log('✅ Slash commands registered.');
    } catch (error) {
        console.error('❌ Startup error:', error);
    }
});

client.login(process.env.TOKEN);
