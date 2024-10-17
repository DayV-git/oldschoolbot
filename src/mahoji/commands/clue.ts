import type { CommandRunOptions } from '@oldschoolgg/toolkit/util';
import { ApplicationCommandOptionType } from 'discord.js';
import { Time, notEmpty, randInt } from 'e';
import { Bank } from 'oldschooljs';
import type { Item, ItemBank } from 'oldschooljs/dist/meta/types';

import type { ClueTier } from '../../lib/clues/clueTiers';
import { ClueTiers } from '../../lib/clues/clueTiers';
import { allOpenables, getOpenableLoot } from '../../lib/openables';
import { getPOHObject } from '../../lib/poh';
import type { ClueActivityTaskOptions } from '../../lib/types/minions';
import { formatDuration, isWeekend, joinStrings, stringMatches } from '../../lib/util';
import addSubTaskToActivityTask from '../../lib/util/addSubTaskToActivityTask';
import { calcMaxTripLength } from '../../lib/util/calcMaxTripLength';
import getOSItem, { getItem } from '../../lib/util/getOSItem';
import { getPOH } from '../lib/abstracted_commands/pohCommand';
import type { OSBMahojiCommand } from '../lib/util';
import { addToOpenablesScores, getMahojiBank, mahojiUsersSettingsFetch } from '../mahojiSettings';

function reducedClueTime(clueTier: ClueTier, score: number) {
	// Every 3 hours become 1% better to a cap of 10%
	const percentReduced = Math.min(Math.floor(score / ((Time.Hour * 3) / clueTier.timeToFinish)), 10);
	const amountReduced = (clueTier.timeToFinish * percentReduced) / 100;
	const reducedTime = clueTier.timeToFinish - amountReduced;

	return [reducedTime, percentReduced];
}

function shouldApplyBoost(clueTier: ClueTier, item: string, hasAchievementDiaryCape: boolean) {
	switch (clueTier.name) {
		case 'Elite':
			return (item !== 'Kandarin headgear 4' && item !== 'Fremennik sea boots 4') || !hasAchievementDiaryCape;
		case 'Master':
			return item !== 'Kandarin headgear 4' || !hasAchievementDiaryCape;
		case 'Hard':
			return item !== 'Wilderness sword 3' || !hasAchievementDiaryCape;
		default:
			return true;
	}
}

interface ClueBoost {
	item: Item;
	boost: string;
	durationMultiplier: number;
}

function applyClueBoosts(user: MUser, boostList: ClueBoost[], boosts: string[], duration: number, clueTier: ClueTier) {
	let hasAchievementDiaryCape = false;
	for (const boost of boostList) {
		if (user.hasEquippedOrInBank(boost.item.name)) {
			if (shouldApplyBoost(clueTier, boost.item.name, hasAchievementDiaryCape)) {
				boosts.push(boost.boost);
				duration *= boost.durationMultiplier;
			}
			if (boost.item.name === 'Achievement diary cape') {
				hasAchievementDiaryCape = true;
			}
		}
	}
	return { duration, boosts };
}

export const clueCommand: OSBMahojiCommand = {
	name: 'clue',
	description: 'Send your minion to complete clue scrolls.',
	attributes: {
		requiresMinion: true,
		requiresMinionNotBusy: true,
		examples: ['/clue tier:easy']
	},
	options: [
		{
			type: ApplicationCommandOptionType.String,
			name: 'tier',
			description: 'The clue you want to do.',
			required: true,
			autocomplete: async (value, user) => {
				const bank = getMahojiBank(await mahojiUsersSettingsFetch(user.id, { bank: true }));
				const options = [{ name: 'All', value: 'All' }];
				for (const tier of ClueTiers) {
					options.push({
						name: `${tier.name} (${bank.amount(tier.scrollID)}x Owned)`,
						value: tier.name
					});
				}
				return options.filter(i => !value || i.value.toLowerCase().includes(value));
			}
		},
		{
			type: ApplicationCommandOptionType.String,
			name: 'implings',
			description: 'Implings to use for multiple clues per trip.',
			required: false,
			autocomplete: async (value, user) => {
				const allClueImps = ClueTiers.filter(t => t.name !== 'Beginner')
					.map(i => i.implings)
					.filter(notEmpty)
					.flat()
					.map(getItem)
					.filter(notEmpty);
				const bank = getMahojiBank(await mahojiUsersSettingsFetch(user.id, { bank: true }));
				const hasClueImps = allClueImps.filter(imp => bank.has(imp.id));
				return hasClueImps
					.filter(i => (!value ? true : i.name.toLowerCase().includes(value.toLowerCase())))
					.map(i => ({ name: `${i.name} (${bank.amount(i.id)}x Owned)`, value: i.name }));
			}
		}
	],
	run: async ({ options, userID, channelID }: CommandRunOptions<{ tier: string; implings?: string }>) => {
		const user = await mUserFetch(userID);
		const doingAll = stringMatches('All', options.tier);

		const clueTier = ClueTiers.find(
			tier => stringMatches(tier.id.toString(), options.tier) || stringMatches(tier.name, options.tier)
		)!;
		if (!clueTier && !doingAll) return 'Invalid clue tier.';

		const clueImpling = options.implings
			? getItem(/^[0-9]+$/.test(options.implings) ? Number(options.implings) : options.implings)
			: null;

		if (options.implings) {
			if (!clueImpling) {
				return `Invalid impling. Please check your entry, **${options.implings}** doesn't match any impling jars. Make sure the quantity isn't included, etc.`;
			}
			if (doingAll) return 'You cant open implings when doing all clues in bank.';
			if (!user.bank.has(clueImpling.id)) return `You don't have any ${clueImpling.name}s in your bank.`;
			if (!clueTier.implings?.includes(clueImpling.id)) return `These clues aren't found in ${clueImpling.name}s`;
		}

		const boosts = [];
		let quantity = 1;

		const stats = await user.fetchStats({ openable_scores: true });

		const clueList = doingAll ? ClueTiers.filter(tier => user.bank.amount(tier.scrollID) > 0) : [clueTier];
		if (doingAll && clueList.length === 0) return `You don't have any clues in your bank.`;
		let timeToFinish = 0;
		const maxTripLength = calcMaxTripLength(user, 'ClueCompletion');

		const poh = await getPOH(user.id);
		const hasOrnateJewelleryBox = poh.jewellery_box === getPOHObject('Ornate jewellery box').id;
		const hasJewelleryBox = poh.jewellery_box !== null;
		const hasXericTalisman = poh.amulet === getPOHObject("Mounted xeric's talisman").id;

		// Global Boosts
		const globalBoosts = [
			{
				condition: isWeekend,
				boost: '10% for Weekend',
				durationMultiplier: 0.9
			},
			{
				condition: () => user.hasEquippedOrInBank('Max cape'),
				boost: '10% for Max cape',
				durationMultiplier: 0.9
			},
			{
				condition: () => !user.hasEquippedOrInBank('Max cape') && user.hasEquippedOrInBank('Construct. cape'),
				boost: '6% for Construction cape',
				durationMultiplier: 0.94
			},
			{
				condition: () => hasOrnateJewelleryBox,
				boost: '10% for Ornate jewellery box',
				durationMultiplier: 0.9
			},
			{
				condition: () => !hasOrnateJewelleryBox && hasJewelleryBox,
				boost: '5% for Basic/Fancy jewellery box',
				durationMultiplier: 0.95
			}
		];

		// Specific boosts
		const clueTierBoosts: Record<ClueTier['name'], ClueBoost[]> = {
			Beginner: [
				{
					item: getOSItem('Ring of the elements'),
					boost: '10% for Ring of the elements',
					durationMultiplier: 0.9
				}
			],
			Easy: [
				{
					item: getOSItem('Achievement diary cape'),
					boost: '10% for Achievement diary cape',
					durationMultiplier: 0.9
				},
				{
					item: getOSItem('Ring of the elements'),
					boost: '6% for Ring of the elements',
					durationMultiplier: 0.94
				}
			],
			Medium: [
				{
					item: getOSItem('Ring of the elements'),
					boost: '8% for Ring of the elements',
					durationMultiplier: 0.92
				}
			],
			Hard: [
				{
					item: getOSItem('Achievement diary cape'),
					boost: '10% for Achievement diary cape',
					durationMultiplier: 0.9
				},
				{
					item: getOSItem('Wilderness sword 3'),
					boost: '8% for Wilderness sword 3',
					durationMultiplier: 0.92
				},
				{
					item: getOSItem('Royal seed pod'),
					boost: '6% for Royal seed pod',
					durationMultiplier: 0.94
				},
				{
					item: getOSItem('Eternal teleport crystal'),
					boost: '4% for Eternal teleport crystal',
					durationMultiplier: 0.96
				},
				{
					item: getOSItem("Pharaoh's sceptre"),
					boost: "4% for Pharaoh's sceptre",
					durationMultiplier: 0.96
				},
				{
					item: getOSItem('Toxic blowpipe'),
					boost: '4% for Toxic blowpipe',
					durationMultiplier: 0.96
				}
			],
			Elite: [
				{
					item: getOSItem('Achievement diary cape'),
					boost: '10% for Achievement diary cape',
					durationMultiplier: 0.9
				},
				{
					item: getOSItem('Kandarin headgear 4'),
					boost: '7% for Kandarin headgear 4',
					durationMultiplier: 0.93
				},
				{
					item: getOSItem('Fremennik sea boots 4'),
					boost: '3% for Fremennik sea boots 4',
					durationMultiplier: 0.97
				},
				{
					item: getOSItem("Pharaoh's sceptre"),
					boost: "4% for Pharaoh's sceptre",
					durationMultiplier: 0.96
				},
				{
					item: getOSItem('Toxic blowpipe'),
					boost: '4% for Toxic blowpipe',
					durationMultiplier: 0.96
				}
			],
			Master: [
				{
					item: getOSItem('Achievement diary cape'),
					boost: '10% for Achievement diary cape',
					durationMultiplier: 0.9
				},
				{
					item: getOSItem('Kandarin headgear 4'),
					boost: '6% for Kandarin headgear 4',
					durationMultiplier: 0.94
				},
				{
					item: getOSItem('Music cape'),
					boost: '5% for Music cape',
					durationMultiplier: 0.95
				},
				{
					item: getOSItem('Eternal teleport crystal'),
					boost: '3% for Eternal teleport crystal',
					durationMultiplier: 0.97
				},
				{
					item: getOSItem('Toxic blowpipe'),
					boost: '2% for Toxic blowpipe',
					durationMultiplier: 0.98
				},
				{
					item: getOSItem('Dragon claws'),
					boost: '1% for Dragon claws',
					durationMultiplier: 0.99
				}
			]
		};

		const cluesToDo = [];

		for (const { condition, boost } of globalBoosts) {
			if (condition()) {
				boosts.push(boost);
			}
		}

		for (const tier of clueList.reverse()) {
			const clueTierName = tier.name;
			let [currentClueTime, percentReduced] = reducedClueTime(
				tier,
				(stats.openable_scores as ItemBank)[tier.id] ?? 1
			);

			if (percentReduced >= 1) boosts.push(`${percentReduced}% for Clue score`);
			if (timeToFinish + currentClueTime > maxTripLength) break;
			cluesToDo.push(tier);
			boosts.push(`**${clueTierName}**`);

			const randomAddedDuration = randInt(1, 20);
			currentClueTime += (randomAddedDuration * currentClueTime) / 100;

			for (const { condition, durationMultiplier } of globalBoosts) {
				if (condition()) {
					currentClueTime *= durationMultiplier;
				}
			}

			// Xeric's Talisman boost
			if (clueTierName === 'Medium' && hasXericTalisman) {
				boosts.push("2% for Mounted Xeric's Talisman");
				currentClueTime *= 0.98;
			}

			const boostList = clueTierBoosts[clueTierName];
			const result = applyClueBoosts(user, boostList, boosts, currentClueTime, tier);

			timeToFinish += result.duration;
		}

		let implingLootString = '';
		let implingClues = 0;
		if (!clueImpling) {
			const cost = new Bank();
			if (doingAll) {
				for (const tier of cluesToDo) {
					cost.add(tier.scrollID);
				}
			} else {
				cost.add(clueTier.scrollID);
			}
			if (!user.owns(cost)) return `You don't own ${cost}.`;
			await user.removeItemsFromBank(cost);
		} else {
			const implingJarOpenable = allOpenables.find(o => o.aliases.some(a => stringMatches(a, clueImpling.name)));
			// If this triggers, it means OSJS probably broke / is missing an alias for an impling jar:
			if (!implingJarOpenable) return 'Invalid impling jar.';

			const bankedClues = user.bank.amount(clueTier.scrollID);
			const maxCanDo = Math.floor(maxTripLength / timeToFinish);
			const bankedImplings = user.bank.amount(clueImpling.id);
			let openedImplings = 0;
			const implingLoot = new Bank();
			while (implingClues + bankedClues < maxCanDo && openedImplings < bankedImplings) {
				const impLoot = await getOpenableLoot({ openable: implingJarOpenable, user, quantity: 1 });
				implingLoot.add(impLoot.bank);
				implingClues = implingLoot.amount(clueTier.scrollID);
				openedImplings++;
			}
			if (implingLoot.has(clueTier.scrollID)) {
				implingLoot.remove(clueTier.scrollID, implingLoot.amount(clueTier.scrollID));
			}

			await addToOpenablesScores(user, new Bank().add(implingJarOpenable.id, openedImplings));
			await user.transactItems({
				itemsToAdd: implingLoot,
				itemsToRemove: new Bank().add(clueImpling, openedImplings).add(clueTier.scrollID, bankedClues),
				collectionLog: true
			});
			if (bankedClues + implingClues === 0) {
				return `You don't have any clues, and didn't find any in ${openedImplings}x ${clueImpling.name}s. At least you received the following loot: ${implingLoot}.`;
			}
			quantity = bankedClues + implingClues;
			implingLootString = `\n\nYou will find ${implingClues} clue${
				implingClues === 0 || implingClues > 1 ? 's' : ''
			} from ${openedImplings}x ${clueImpling.name}s, and receive the following loot: ${implingLoot}.`;
		}

		const duration = timeToFinish * quantity;

		await addSubTaskToActivityTask<ClueActivityTaskOptions>({
			ci: cluesToDo.map(tier => tier.id),
			implingID: clueImpling ? clueImpling.id : undefined,
			implingClues: clueImpling ? implingClues : undefined,
			userID: user.id,
			channelID: channelID.toString(),
			q: quantity,
			duration,
			type: 'ClueCompletion'
		});
		return `${user.minionName} is now completing ${quantity}x ${joinStrings(
			cluesToDo.reverse().map(tier => tier.name)
		)} clues, it'll take around ${formatDuration(duration)} to finish.${
			boosts.length > 0 ? `\n\n**Boosts:** ${boosts.join(', ')}.` : ''
		}${implingLootString}`;
	}
};
