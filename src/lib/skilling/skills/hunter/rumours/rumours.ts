import { type CommandResponse, formatDuration, mentionCommand } from '@oldschoolgg/toolkit';
import { Time, roll } from 'e';
import { QuestID } from '../../../../minions/data/quests';
import type { RumourActivityTaskOptions } from '../../../../types/minions';
import addSubTaskToActivityTask from '../../../../util/addSubTaskToActivityTask';
import { calcMaxTripLength } from '../../../../util/calcMaxTripLength';
import { type Creature, HunterTechniqueEnum, SkillsEnum } from '../../../types';
import creatures from '../creatures';
import { getRumourBlockList } from './rumourBlocks';
import { type Rumour, type RumourOption, tierToHunterLevel } from './util';

const hunterTechniqueToRate: { [key in HunterTechniqueEnum]: number } = {
	[HunterTechniqueEnum.AerialFishing]: -1,
	[HunterTechniqueEnum.DriftNet]: -1,
	[HunterTechniqueEnum.BirdSnaring]: 20,
	[HunterTechniqueEnum.BoxTrapping]: 50,
	[HunterTechniqueEnum.ButterflyNetting]: 75,
	[HunterTechniqueEnum.DeadfallTrapping]: 15,
	[HunterTechniqueEnum.Falconry]: 10,
	[HunterTechniqueEnum.MagicBoxTrapping]: -1,
	[HunterTechniqueEnum.NetTrapping]: 25,
	[HunterTechniqueEnum.PitfallTrapping]: 15,
	[HunterTechniqueEnum.RabbitSnaring]: -1,
	[HunterTechniqueEnum.Tracking]: 15
};

export async function rumoursCommand(userID: string, channelID: string, input?: RumourOption): CommandResponse {
	const user = await mUserFetch(userID);
	const hunterLevel = user.skillsAsLevels.hunter;

	if (!user.user.finished_quest_ids.includes(QuestID.ChildrenOfTheSun)) {
		return `You need to complete the "Children of the Sun" quest before you can be assigned a hunter rumour. Send your minion to do the quest using: ${mentionCommand(
			globalClient,
			'activities',
			'quest'
		)}.`;
	}

	if (hunterLevel < 46) {
		return 'You need at least level 46 in Hunter to begin doing Hunter Rumours.';
	}

	if (!input) {
		const bestTier = highestLevelRumour(user);
		return rumoursCommand(user.id, channelID, bestTier);
	}

	if (hunterLevel < tierToHunterLevel[input]) {
		return `You need level ${tierToHunterLevel[input]} hunter to do rumours of ${input} difficulty!`;
	}

	const maxTripLength = calcMaxTripLength(user);
	const Rumours: Rumour[] = await generateRumourTasks(user, input, maxTripLength);

	const totalDuration = Rumours.reduce((acc, rumour) => acc + rumour.duration, 0);

	await addSubTaskToActivityTask<RumourActivityTaskOptions>({
		userID: user.id,
		channelID: channelID,
		quantity: Rumours.length,
		tier: input,
		rumours: Rumours,
		duration: totalDuration,
		type: 'Rumour'
	});

	return `${user.minionName} is now completing ${input} tier rumours. It'll return in ${formatDuration(totalDuration)}.`;
}

async function generateRumourTasks(user: MUser, tier: RumourOption, maxLength: Time.Minute) {
	const Rumours: Rumour[] = [];
	let totalDuration = 0;
	const maxDurationInSeconds = maxLength / 1000;
	const blockList = (await getRumourBlockList(user.id)).rumour_blocked_ids;

	const filteredCreatures = creatures.filter(
		creature =>
			creature.tier?.includes(tier) &&
			creature.level <= user.skillsAsLevels.hunter &&
			(!creature.qpRequired || user.QP >= creature.qpRequired) &&
			(!creature.herbloreLvl || user.skillsAsLevels.herblore >= creature.herbloreLvl) &&
			!blockList.includes(creature.id)
	);

	let lastSelectedCreature: Creature | null = null;

	while (totalDuration < maxDurationInSeconds) {
		const shuffledCreatures = filteredCreatures.sort(() => 0.5 - Math.random());

		let selectedCreature: Creature | null = null;
		for (const creature of shuffledCreatures) {
			if (creature !== lastSelectedCreature) {
				selectedCreature = creature;
				break;
			}
		}

		if (!selectedCreature) break;

		const DurationAndQty = calcDurationAndQty(selectedCreature, user);
		if (tier === 'novice' || tier === 'adept') DurationAndQty[0] += 50; //Extra 50 seconds per task for low rumour tier (creatures are more spread out)

		if (totalDuration + DurationAndQty[0] > maxDurationInSeconds + maxDurationInSeconds / 3) {
			break;
		}

		Rumours.push({
			creature: selectedCreature,
			duration: Time.Second * DurationAndQty[0],
			quantity: DurationAndQty[1]
		});

		totalDuration += DurationAndQty[0];
		lastSelectedCreature = selectedCreature;
	}

	return Rumours;
}

function calcDurationAndQty(creature: Creature, user: MUser): [number, number] {
	const dropRate = hunterTechniqueToRate[creature.huntTechnique];

	if (dropRate === -1) {
		throw new Error(
			`Drop rate not defined for hunting technique: ${creature.huntTechnique} This shouldn't be possible as all possible rumours have assigned droprates`
		);
	}

	let creaturesHunted = 0;

	for (let i = 0; i < dropRate * 2; i++) {
		creaturesHunted++;

		if (roll(dropRate)) {
			break;
		}
	}

	const chanceOfSuccess = creature.slope * user.skillsAsLevels.hunter + creature.intercept;
	let totalCreaturesHunted = creaturesHunted;
	if (chanceOfSuccess < 1) totalCreaturesHunted = Math.floor(creaturesHunted / chanceOfSuccess);

	let catchtime = creature.catchTime;
	let traps = 1;
	if (creature.multiTraps) {
		traps += Math.min(Math.floor(user.skillLevel(SkillsEnum.Hunter) / 20), 5);
	}

	catchtime = catchtime / traps;

	const timeTaken = totalCreaturesHunted * catchtime + 40; //40 Seconds assumed for time taken to get hunter gear out and make it to the location.

	return [timeTaken, creaturesHunted];
}

function highestLevelRumour(user: MUser) {
	return Object.entries(tierToHunterLevel)
		.sort((a, b) => b[1] - a[1])
		.find(a => user.skillLevel('hunter') >= a[1])?.[0] as RumourOption | undefined;
}

export async function rumourCount(userID: string): CommandResponse {
	const user = await mUserFetch(userID);
	const { rumours: rumoursCompleted } = await user.fetchStats({ rumours: true });
	const totalrumours = rumoursCompleted.reduce((a, b) => a + b);

	if (totalrumours) {
		return `Your minion has completed:\n${rumoursCompleted[0]} Novice rumours.\n${rumoursCompleted[1]} Adept rumours.\n${rumoursCompleted[2]} Expert rumours.\n${rumoursCompleted[3]} Master rumours.\nTotal: ${totalrumours}`;
	} else {
		return `Your minion has not completed any rumours yet. You can send your minion to complete rumours by running ${mentionCommand(
			globalClient,
			'rumours',
			'start'
		)}`;
	}
}
