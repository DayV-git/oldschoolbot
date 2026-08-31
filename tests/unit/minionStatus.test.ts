import { MathRNG } from 'node-rng';
import { describe, expect, it, vi } from 'vitest';

import killableMonsters from '../../src/lib/minions/data/killableMonsters/index.js';
import { Farming } from '../../src/lib/skilling/skills/farming/index.js';
import type { IPatchData } from '../../src/lib/skilling/skills/farming/utils/types.js';
import Mining from '../../src/lib/skilling/skills/mining.js';
import type { ActivityTaskData, FarmingActivityTaskOptions } from '../../src/lib/types/minions.js';
import { minionStatus } from '../../src/lib/util/minionStatus.js';
import { formatTripDuration } from '../../src/lib/util/minionUtils.js';
import { mockMUser } from './userutil.js';

const defaultPatch: IPatchData = {
	lastPlanted: null,
	patchPlanted: false,
	plantTime: 0,
	lastQuantity: 0,
	lastUpgradeType: null,
	lastPayment: false
};

describe('minionStatus - Farming', () => {
	const plantsName = Farming.Plants[0].name;

	it('shows combined auto-farm with the current task remaining time', () => {
		const now = new Date('2024-01-01T00:00:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(now);

		const user = mockMUser({ id: '123' });
		const currentDuration = 40_000;
		const planDuration = 60_000;
		const task: FarmingActivityTaskOptions = {
			type: 'Farming',
			userID: user.id,
			channelId: '456',
			id: 1,
			duration: currentDuration,
			finishDate: now.getTime() + currentDuration,
			plantsName,
			quantity: 2,
			upgradeType: null,
			patchType: defaultPatch,
			planting: true,
			currentDate: now.getTime(),
			autoFarmed: true,
			autoFarmPlan: [
				{
					plantsName: 'Guam',
					quantity: 5,
					upgradeType: null,
					patchType: defaultPatch,
					planting: true,
					currentDate: now.getTime(),
					payment: false,
					duration: planDuration
				}
			],
			autoFarmCombined: true
		};

		const result = minionStatus(user, task);
		const expectedRemaining = `${formatTripDuration(user, currentDuration)} remaining`;

		expect(result).toContain('auto-farming multiple patches');
		expect(result).toContain(`Estimated time remaining: ${expectedRemaining}.`);
		expect(result).toContain(`Current step: ${plantsName} (${task.quantity}x).`);

		vi.useRealTimers();
	});

	it('keeps normal farming output when not combined', () => {
		const now = new Date('2024-01-01T00:00:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(now);

		const user = mockMUser({ id: '987' });
		const currentDuration = 25_000;
		const task: FarmingActivityTaskOptions = {
			type: 'Farming',
			userID: user.id,
			channelId: '789',
			id: 2,
			duration: currentDuration,
			finishDate: now.getTime() + currentDuration,
			plantsName,
			quantity: 1,
			upgradeType: null,
			patchType: defaultPatch,
			planting: true,
			currentDate: now.getTime(),
			autoFarmed: false
		};

		const result = minionStatus(user, task);

		expect(result).toContain(`currently farming ${task.quantity}x ${plantsName}`);
		expect(result).toContain(`${formatTripDuration(user, currentDuration)} remaining.`);
		expect(result).not.toContain('auto-farming multiple patches');

		vi.useRealTimers();
	});
});

describe('minionStatus - core rendering paths', () => {
	const now = new Date('2024-01-01T00:00:00.000Z').getTime();

	it('reports an idle minion', () => {
		const user = mockMUser({ id: 'idle-user' });

		expect(minionStatus(user, null, MathRNG, now)).toBe(`${user.minionName} is currently doing nothing.`);
	});

	it('renders a looked-up activity and its standard remaining duration', () => {
		const user = mockMUser({ id: 'monster-user' });
		const monster = killableMonsters[0]!;
		const duration = 30_000;
		const task = {
			type: 'MonsterKilling',
			finishDate: now + duration,
			mi: monster.id,
			q: 2
		} as unknown as ActivityTaskData;

		expect(minionStatus(user, task, MathRNG, now)).toBe(
			`${user.minionName} is currently killing 2x ${monster.name}. ${formatTripDuration(user, duration)} remaining.`
		);
	});

	it('uses the injected RNG and clock for estimated-duration activities', () => {
		const user = mockMUser({ id: 'mining-user' });
		const ore = Mining.Ores[0]!;
		const duration = 20_000;
		const task = {
			type: 'Mining',
			finishDate: now + duration,
			oreID: ore.id,
			fakeDurationMin: 0,
			fakeDurationMax: 1
		} as unknown as ActivityTaskData;
		const rng = { randomVariation: (value: number) => value } as unknown as typeof MathRNG;

		const result = minionStatus(user, task, rng, now);

		expect(result).toContain(
			`approximately ${formatTripDuration(user, 15_000)} **to** ${formatTripDuration(user, 25_000)} remaining.`
		);
	});

	it('uses the activity-specific duration formula for Fight Caves', () => {
		const user = mockMUser({ id: 'fight-caves-user' });
		const task = {
			type: 'FightCaves',
			finishDate: now + 10_000,
			duration: 10_000,
			fakeDuration: 60_000
		} as unknown as ActivityTaskData;

		expect(minionStatus(user, task, MathRNG, now)).toContain(
			`the trip should take ${formatTripDuration(user, 60_000)}.`
		);
	});

	it('continues to reject removed activity types', () => {
		const user = mockMUser({ id: 'removed-user' });
		const task = { type: 'Easter', finishDate: now } as unknown as ActivityTaskData;

		expect(() => minionStatus(user, task, MathRNG, now)).toThrow('Removed');
	});
});
