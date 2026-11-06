import { GoogleGenAI } from '@google/genai';
import { Car, UserFilter, UserProfile, RecommendationResult, StringOrStringArray } from '@/lib/types';

const MAX_LIMIT = 40;
const DEFAULT_LIMIT = 10;
const MIN_COLOR_SCORE = 0.35;
const MIN_BUDGET_TOLERANCE = 2500;

const userProfiles = new Map<string, UserProfile>();
const descriptionCache = new Map<string, Map<number, string>>();
let genAiClient: GoogleGenAI | null = null;

export type RecommendationOptions = {
  sessionId: string;
  userFilter: UserFilter;
  listings: Car[];
  limit?: number;
  /** Called before each Gemini request; returning false uses the template description. */
  allowGeminiCall?: () => boolean;
};

export function getOrCreateUserProfile(sessionId: string): UserProfile {
  const key = sessionId || 'anonymous';
  const existing = userProfiles.get(key);
  if (existing) return existing;
  const profile: UserProfile = {
    likedCountByModel: Object.create(null),
    likedCountByCategory: Object.create(null),
    likedCountByDrivetrain: Object.create(null),
    likedCountByFuelType: Object.create(null),
    likedCountByExteriorColor: Object.create(null),
    likedCountByInteriorColor: Object.create(null),
    likedCountByDoors: Object.create(null),
    likedCountBySeating: Object.create(null),
    rejectedCountByModel: Object.create(null),
    rejectedCountByCategory: Object.create(null),
    rejectedCountByDrivetrain: Object.create(null),
    rejectedCountByFuelType: Object.create(null),
    rejectedCountByExteriorColor: Object.create(null),
    rejectedCountByInteriorColor: Object.create(null),
    rejectedCountByDoors: Object.create(null),
    rejectedCountBySeating: Object.create(null),
    totalLikes: 0,
    totalRejects: 0,
    budgetMean: null,
    budgetStdDev: null,
    budgetSampleCount: 0,
    budgetM2: 0,
    lastUpdated: Date.now(),
  };
  userProfiles.set(key, profile);
  return profile;
}

export function getSessionDescriptionCache(sessionId: string) {
  if (!descriptionCache.has(sessionId)) {
    descriptionCache.set(sessionId, new Map());
  }
  return descriptionCache.get(sessionId)!;
}

export function updateUserProfileWithFeedback(profile: UserProfile, listing: Car, feedback: 'like' | 'reject') {
  const isLike = feedback === 'like';
  bumpAttribute(isLike ? profile.likedCountByModel : profile.rejectedCountByModel, listing.Model);
  bumpAttribute(isLike ? profile.likedCountByCategory : profile.rejectedCountByCategory, listing.VehicleCategory || listing.Type);
  bumpAttribute(isLike ? profile.likedCountByDrivetrain : profile.rejectedCountByDrivetrain, listing.Drivetrain);
  bumpAttribute(isLike ? profile.likedCountByFuelType : profile.rejectedCountByFuelType, listing['Fuel Type'] || listing.FuelType);
  bumpAttribute(isLike ? profile.likedCountByExteriorColor : profile.rejectedCountByExteriorColor, listing.ExteriorColor);
  bumpAttribute(isLike ? profile.likedCountByInteriorColor : profile.rejectedCountByInteriorColor, listing.InteriorColor);
  bumpNumeric(isLike ? profile.likedCountByDoors : profile.rejectedCountByDoors, listing.Doors);
  bumpNumeric(isLike ? profile.likedCountBySeating : profile.rejectedCountBySeating, listing.Seating);

  if (isLike) {
    profile.totalLikes += 1;
    updateBudgetStats(profile, listing.Price);
  } else {
    profile.totalRejects += 1;
  }
  profile.lastUpdated = Date.now();
}

export async function buildRecommendations({
  sessionId,
  userFilter,
  listings,
  limit = DEFAULT_LIMIT,
  allowGeminiCall,
}: RecommendationOptions): Promise<RecommendationResult[]> {
  const normalizedFilter = sanitizeFilter(userFilter);
  const profile = getOrCreateUserProfile(sessionId);
  const hardFiltered = filterListings(listings, normalizedFilter);
  const pool = hardFiltered.length ? hardFiltered : listings;

  const scored = pool.map(car => ({
    car,
    score: scoreCarInternal(car, normalizedFilter, profile),
  }));

  scored.sort((a, b) => b.score - a.score);
  const capped = scored.slice(0, Math.min(Math.max(1, limit), MAX_LIMIT));
  const cache = getSessionDescriptionCache(sessionId);

  const results = await Promise.all(capped.map(async ({ car, score }) => {
    const generated = await generateListingDescription({
      listing: car,
      filter: normalizedFilter,
      profile,
      cache,
      allowGeminiCall,
    });
    const enriched: RecommendationResult = {
      ...car,
      score,
      generated_description: generated,
      FitDescription: generated,
      Score: score,
    };
    return enriched;
  }));

  return results;
}

export function filterListings(listings: Car[], userFilter: UserFilter): Car[] {
  const filter = sanitizeFilter(userFilter);
  const categoryFilters = toArray(filter.vehicle_category).map(v => normalizeCategory(v));
  const conditionFilters = toArray(filter.condition).map(v => v.toLowerCase());
  const minPrice = toNumber(filter.price_min ?? filter.budget_min);
  const maxPrice = deriveMaxBudget(filter);
  const yearMin = toNumber(filter.year_min);
  const yearMax = toNumber(filter.year_max);
  const mileageMin = toNumber(filter.mileage_min);
  const mileageMax = toNumber(filter.mileage_max);
  const seatingMin = toNumber(filter.available_seating);
  const doorsMin = toNumber(filter.doors);

  return listings.filter(listing => {
    if (minPrice != null && listing.Price < minPrice) return false;
    if (maxPrice != null && listing.Price > maxPrice) return false;
    if (yearMin != null && listing.Year && listing.Year < yearMin) return false;
    if (yearMax != null && listing.Year && listing.Year > yearMax) return false;
    if (mileageMin != null && typeof listing.Mileage === 'number' && listing.Mileage < mileageMin) return false;
    if (mileageMax != null && typeof listing.Mileage === 'number' && listing.Mileage > mileageMax) return false;
    if (seatingMin != null && typeof listing.Seating === 'number' && listing.Seating + 1 < seatingMin) return false;
    if (doorsMin != null && typeof listing.Doors === 'number' && listing.Doors < doorsMin) return false;

    if (categoryFilters.length) {
      const listingCategory = normalizeCategory(listing.VehicleCategory || listing.Type || '');
      if (!categoryFilters.some(cat => listingCategory.includes(cat))) return false;
    }

    if (conditionFilters.length) {
      const cond = (listing.Condition || '').toLowerCase();
      const usedLabel = listing.Used ? 'used' : 'new';
      if (!conditionFilters.some(item => cond.includes(item) || usedLabel.includes(item))) {
        return false;
      }
    }

    return true;
  });
}

export function scoreCar(listing: Car, userFilter: UserFilter, profile?: UserProfile): number {
  return scoreCarInternal(listing, sanitizeFilter(userFilter), profile ?? null);
}

function scoreCarInternal(listing: Car, filter: UserFilter, profile: UserProfile | null): number {
  const budgetScore = computeBudgetScore(listing, filter, profile);
  const attributeScore = computeAttributeScore(listing, filter);
  const preferenceScore = computePreferenceScore(listing, profile);
  const finalScore = (0.4 * budgetScore) + (0.4 * attributeScore) + (0.2 * preferenceScore);
  return clamp(finalScore, 0, 1);
}

function computeBudgetScore(listing: Car, filter: UserFilter, profile: UserProfile | null): number {
  const target = deriveBudgetTarget(filter, profile);
  if (!target || target <= 0) return 0.5;
  const diff = Math.abs(listing.Price - target);
  const tolerance = deriveBudgetTolerance(filter, profile, target);
  const normalized = Math.max(0, 1 - diff / tolerance);
  return clamp(normalized, 0, 1);
}

function computeAttributeScore(listing: Car, filter: UserFilter): number {
  let totalWeight = 0;
  let accumulated = 0;

  const weights = {
    model: 0.18,
    year: 0.1,
    category: 0.12,
    drivetrain: 0.08,
    fuel: 0.08,
    seating: 0.07,
    doors: 0.05,
    exteriorColor: 0.12,
    interiorColor: 0.08,
    mileage: 0.1,
    transmission: 0.02,
  } as const;

  const modelQueries = buildModelQueries(filter);
  if (modelQueries.length) {
    totalWeight += weights.model;
    accumulated += weights.model * computeModelScore(listing.Model, modelQueries);
  }

  if (filter.year_min != null || filter.year_max != null) {
    totalWeight += weights.year;
    accumulated += weights.year * computeYearScore(listing.Year, filter.year_min, filter.year_max);
  }

  const categories = toArray(filter.vehicle_category);
  if (categories.length) {
    totalWeight += weights.category;
    accumulated += weights.category * computeCategoryScore(listing, categories);
  }

  const drivetrains = toArray(filter.drivetrain);
  if (drivetrains.length) {
    totalWeight += weights.drivetrain;
    accumulated += weights.drivetrain * computeDrivetrainScore(listing, drivetrains);
  }

  const fuels = toArray(filter.fuel_type);
  if (fuels.length) {
    totalWeight += weights.fuel;
    accumulated += weights.fuel * computeFuelScore(listing, fuels);
  }

  if (filter.available_seating != null) {
    totalWeight += weights.seating;
    accumulated += weights.seating * computeSeatingScore(listing.Seating, filter.available_seating);
  }

  if (filter.doors != null) {
    totalWeight += weights.doors;
    accumulated += weights.doors * computeDoorsScore(listing.Doors, filter.doors);
  }

  const exteriorColors = toArray(filter.exterior_color);
  if (exteriorColors.length) {
    totalWeight += weights.exteriorColor;
    accumulated += weights.exteriorColor * computeColorScore(listing.ExteriorColor, exteriorColors);
  }

  const interiorColors = toArray(filter.interior_color);
  if (interiorColors.length) {
    totalWeight += weights.interiorColor;
    accumulated += weights.interiorColor * computeColorScore(listing.InteriorColor, interiorColors);
  }

  if (filter.mileage_max != null || filter.mileage_min != null) {
    totalWeight += weights.mileage;
    accumulated += weights.mileage * computeMileageScore(listing.Mileage, filter.mileage_min, filter.mileage_max);
  }

  if (filter.transmission) {
    totalWeight += weights.transmission;
    accumulated += weights.transmission * computeTransmissionScore(listing.Transmission, toArray(filter.transmission));
  }

  if (!totalWeight) return 0.5;
  return clamp(accumulated / totalWeight, 0, 1);
}

function computePreferenceScore(listing: Car, profile: UserProfile | null): number {
  if (!profile) return 0;
  const weights = {
    price: 0.2,
    model: 0.2,
    category: 0.15,
    drivetrain: 0.1,
    fuel: 0.1,
    exterior: 0.08,
    interior: 0.05,
    seating: 0.06,
    doors: 0.06,
  } as const;
  let total = 0;
  let weightSum = 0;

  const priceSignal = computePricePreferenceSignal(listing.Price, profile);
  if (priceSignal != null) {
    weightSum += weights.price;
    total += weights.price * priceSignal;
  }

  const modelSignal = computePreferenceSignal(listing.Model, profile.likedCountByModel, profile.rejectedCountByModel);
  if (modelSignal != null) {
    weightSum += weights.model;
    total += weights.model * modelSignal;
  }

  const categorySignal = computePreferenceSignal(listing.VehicleCategory || listing.Type, profile.likedCountByCategory, profile.rejectedCountByCategory);
  if (categorySignal != null) {
    weightSum += weights.category;
    total += weights.category * categorySignal;
  }

  const drivetrainSignal = computePreferenceSignal(listing.Drivetrain, profile.likedCountByDrivetrain, profile.rejectedCountByDrivetrain);
  if (drivetrainSignal != null) {
    weightSum += weights.drivetrain;
    total += weights.drivetrain * drivetrainSignal;
  }

  const fuelSignal = computePreferenceSignal(listing['Fuel Type'] || listing.FuelType, profile.likedCountByFuelType, profile.rejectedCountByFuelType);
  if (fuelSignal != null) {
    weightSum += weights.fuel;
    total += weights.fuel * fuelSignal;
  }

  const exteriorSignal = computePreferenceSignal(listing.ExteriorColor, profile.likedCountByExteriorColor, profile.rejectedCountByExteriorColor);
  if (exteriorSignal != null) {
    weightSum += weights.exterior;
    total += weights.exterior * exteriorSignal;
  }

  const interiorSignal = computePreferenceSignal(listing.InteriorColor, profile.likedCountByInteriorColor, profile.rejectedCountByInteriorColor);
  if (interiorSignal != null) {
    weightSum += weights.interior;
    total += weights.interior * interiorSignal;
  }

  const seatingSignal = computeNumericPreferenceSignal(listing.Seating, profile.likedCountBySeating, profile.rejectedCountBySeating);
  if (seatingSignal != null) {
    weightSum += weights.seating;
    total += weights.seating * seatingSignal;
  }

  const doorsSignal = computeNumericPreferenceSignal(listing.Doors, profile.likedCountByDoors, profile.rejectedCountByDoors);
  if (doorsSignal != null) {
    weightSum += weights.doors;
    total += weights.doors * doorsSignal;
  }

  return weightSum ? clamp(total / weightSum, 0, 1) : 0;
}

type DescriptionParams = {
  listing: Car;
  filter: UserFilter;
  profile: UserProfile;
  cache: Map<number, string>;
  allowGeminiCall?: () => boolean;
};

async function generateListingDescription({ listing, filter, profile, cache, allowGeminiCall }: DescriptionParams): Promise<string> {
  const cached = cache.get(listing.Id);
  if (cached) return cached;
  let description = '';
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const rateLimited = Boolean(apiKey) && !(allowGeminiCall?.() ?? true);
  if (apiKey && !rateLimited) {
    try {
      if (!genAiClient) {
        genAiClient = new GoogleGenAI({ apiKey });
      }
      description = await generateWithGemini(listing, filter, profile);
    } catch (error) {
      console.warn('Gemini description fallback triggered', error);
    }
  }
  if (!description) {
    description = buildFallbackDescription(listing, filter, profile);
  }
  // Don't cache a rate-limited fallback, so the card can get a Gemini blurb later.
  if (!rateLimited) cache.set(listing.Id, description);
  return description;
}

async function generateWithGemini(listing: Car, filter: UserFilter, profile: UserProfile): Promise<string> {
  if (!genAiClient) throw new Error('Gemini client not initialized');
  const parts = [
    'Write a unique 2 sentence highlight reel for this Toyota listing. Mention year, model, vehicle category, price vs budget, mileage, drivetrain, fuel type, exterior & interior colors, seating, doors, condition, dealership. Keep it upbeat but grounded.',
    `Listing JSON: ${JSON.stringify(listing)}`,
    `User filter: ${JSON.stringify(filter)}`,
    `User profile summary: ${JSON.stringify(summarizeProfile(profile))}`,
  ];
  const response = await genAiClient.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: parts.join('\n') }] }],
    config: { temperature: 0.35 },
  });
  return (response.text || '').trim();
}

function buildFallbackDescription(listing: Car, filter: UserFilter, profile: UserProfile): string {
  const category = listing.VehicleCategory || listing.Type || 'Toyota';
  const mileage = typeof listing.Mileage === 'number' ? `${listing.Mileage.toLocaleString()} miles` : 'dealer-verified mileage';
  const drivetrain = listing.Drivetrain || 'versatile drivetrain';
  const fuel = listing['Fuel Type'] || listing.FuelType || 'fuel-friendly setup';
  const exterior = listing.ExteriorColor || 'neutral paint';
  const interior = listing.InteriorColor || 'easy-clean cabin';
  const seats = listing.Seating != null ? `${listing.Seating} seats` : 'flex seating';
  const doors = listing.Doors != null ? `${listing.Doors} doors` : 'practical access';
  const condition = listing.Condition || (listing.Used ? 'Used' : 'New');
  const dealer = listing.Dealer || listing.Location || 'a Toyota dealer';
  const budgetTarget = deriveBudgetTarget(filter, profile) || profile.budgetMean;
  const budgetPhrase = formatBudgetDelta(listing.Price, budgetTarget);
  const openerChoices = ['Confident', 'Road-trip ready', 'City-smart', 'Family-focused', 'Adventure-tuned'];
  const opener = openerChoices[listing.Id % openerChoices.length];
  const colorPair = `${normalizeColorLabel(exterior)} outside with ${normalizeColorLabel(interior)} inside`;

  const sentenceOne = `${opener} ${listing.Year} ${listing.Model} ${category.toLowerCase()} comes in at ${formatCurrency(listing.Price)} (${budgetPhrase}).`;
  const sentenceTwo = `It brings ${mileage}, ${drivetrain} ${fuel.toLowerCase()}, ${colorPair}, plus ${seats}, ${doors}, and a ${condition.toLowerCase()} rating from ${dealer}.`;
  return `${sentenceOne} ${sentenceTwo}`;
}

function summarizeProfile(profile: UserProfile) {
  return {
    likes: profile.totalLikes,
    rejects: profile.totalRejects,
    budgetMean: profile.budgetMean,
    budgetStdDev: profile.budgetStdDev,
    topModels: topKeys(profile.likedCountByModel, 3),
    topCategories: topKeys(profile.likedCountByCategory, 3),
  };
}

function formatBudgetDelta(price: number, budgetTarget?: number | null) {
  if (!budgetTarget || budgetTarget <= 0) return 'with room to negotiate';
  const diff = price - budgetTarget;
  if (Math.abs(diff) < 500) return 'right on budget';
  const label = diff > 0 ? 'over' : 'under';
  const formatted = Math.abs(diff).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
  return `${formatted} ${label} budget`;
}

function computePricePreferenceSignal(price: number, profile: UserProfile): number | null {
  if (!profile.budgetMean || profile.budgetMean <= 0) return null;
  const std = profile.budgetStdDev ?? profile.budgetMean * 0.25;
  const tolerance = Math.max(std * 2, profile.budgetMean * 0.35, MIN_BUDGET_TOLERANCE);
  const diff = Math.abs(price - profile.budgetMean);
  return clamp(1 - diff / tolerance, 0, 1);
}

function computePreferenceSignal(value: string | undefined, likes: Record<string, number>, rejects: Record<string, number>): number | null {
  const key = normalizeKey(value);
  if (!key) return null;
  const likeCount = likes[key] ?? 0;
  const rejectCount = rejects[key] ?? 0;
  const total = likeCount + rejectCount;
  if (!total) return null;
  const net = likeCount - rejectCount;
  return net <= 0 ? 0 : clamp(net / total, 0, 1);
}

function computeNumericPreferenceSignal(value: number | undefined, likes: Record<number, number>, rejects: Record<number, number>): number | null {
  if (value == null) return null;
  const likeCount = likes[value] ?? 0;
  const rejectCount = rejects[value] ?? 0;
  const total = likeCount + rejectCount;
  if (!total) return null;
  const net = likeCount - rejectCount;
  return net <= 0 ? 0 : clamp(net / total, 0, 1);
}

function computeModelScore(model: string, queries: string[]): number {
  const normalized = normalizeKey(model);
  if (!normalized) return 0;
  for (const query of queries) {
    if (normalized === query) return 1;
  }
  for (const query of queries) {
    if (normalized.includes(query)) return 0.75;
  }
  return 0.2;
}

function computeYearScore(year: number, min?: number | null, max?: number | null): number {
  if (!year) return 0;
  const lower = toNumber(min);
  const upper = toNumber(max);
  if (lower == null && upper == null) return 0.5;
  if (lower != null && year < lower) {
    const diff = lower - year;
    return clamp(1 - diff / 5, 0, 1);
  }
  if (upper != null && year > upper) {
    const diff = year - upper;
    return clamp(1 - diff / 5, 0, 1);
  }
  return 1;
}

function computeCategoryScore(listing: Car, categories: string[]): number {
  const normalized = normalizeCategory(listing.VehicleCategory || listing.Type || '');
  if (!normalized) return 0;
  return categories.some(cat => normalized.includes(normalizeCategory(cat))) ? 1 : 0;
}

function computeDrivetrainScore(listing: Car, drivetrains: string[]): number {
  const value = normalizeKey(listing.Drivetrain);
  if (!value) return 0;
  return drivetrains.some(dt => value.includes(normalizeKey(dt) || '')) ? 1 : 0;
}

function computeFuelScore(listing: Car, fuels: string[]): number {
  const value = normalizeKey(listing['Fuel Type'] || listing.FuelType);
  if (!value) return 0;
  return fuels.some(fuel => value.includes(normalizeKey(fuel) || '')) ? 1 : 0;
}

function computeSeatingScore(value: number | undefined, target?: number | null): number {
  if (target == null) return 0.5;
  if (value == null) return 0.2;
  if (value >= target) return 1;
  const diff = target - value;
  return clamp(1 - diff / Math.max(target, 1), 0, 1);
}

function computeDoorsScore(value: number | undefined, target?: number | null): number {
  if (target == null) return 0.5;
  if (value == null) return 0.2;
  if (value === target) return 1;
  if (value > target) return 0.7;
  return 0.1;
}

function computeColorScore(color: string | undefined, desired: string[]): number {
  if (!desired.length) return 0.5;
  if (!color) return 0.2;
  const listingColor = normalizeColorLabel(color);
  if (desired.some(target => normalizeColorLabel(target) === listingColor)) return 1;
  if (desired.some(target => colorsRoughlyMatch(target, color))) return 0.65;
  return MIN_COLOR_SCORE;
}

function computeMileageScore(value: number | undefined, min?: number | null, max?: number | null): number {
  if (value == null) return 0.5;
  const lower = toNumber(min);
  const upper = toNumber(max);
  if (upper != null && value > upper) {
    const diff = value - upper;
    return clamp(1 - diff / Math.max(upper * 0.5, 10000), 0, 1);
  }
  if (lower != null && value < lower) {
    const diff = lower - value;
    return clamp(1 - diff / Math.max(lower * 0.5, 10000), 0, 1);
  }
  if (upper != null) {
    return clamp(1 - value / Math.max(upper * 1.5, 1), 0, 1);
  }
  return 0.6;
}

function computeTransmissionScore(value: string | undefined, targets: string[]): number {
  if (!targets.length) return 0;
  const normalized = normalizeKey(value);
  if (!normalized) return 0.2;
  return targets.some(target => normalized.includes(normalizeKey(target) || '')) ? 1 : 0.2;
}

function sanitizeFilter(filter: UserFilter | null | undefined): UserFilter {
  return {
    ...filter,
    budget: toNumber(filter?.budget),
    budget_min: toNumber(filter?.budget_min ?? filter?.price_min),
    budget_max: toNumber(filter?.budget_max ?? filter?.price_max),
    price_min: toNumber(filter?.price_min),
    price_max: toNumber(filter?.price_max),
    mileage_min: toNumber(filter?.mileage_min),
    mileage_max: toNumber(filter?.mileage_max),
    year_min: toNumber(filter?.year_min),
    year_max: toNumber(filter?.year_max),
    available_seating: toNumber(filter?.available_seating),
    doors: toNumber(filter?.doors),
  };
}

function deriveBudgetTarget(filter: UserFilter, profile: UserProfile | null): number | null {
  if (filter.budget) return filter.budget;
  if (filter.budget_min && filter.budget_max) return (filter.budget_min + filter.budget_max) / 2;
  if (filter.budget_max) return filter.budget_max;
  if (filter.budget_min) return filter.budget_min;
  if (profile?.budgetMean) return profile.budgetMean;
  return null;
}

function deriveBudgetTolerance(filter: UserFilter, profile: UserProfile | null, target: number): number {
  const explicitWindow = filter.budget_min != null && filter.budget_max != null
    ? Math.max(Math.abs(filter.budget_max - filter.budget_min) / 2, MIN_BUDGET_TOLERANCE)
    : 0;
  const profileWindow = profile?.budgetStdDev ? profile.budgetStdDev * 2 : 0;
  return Math.max(explicitWindow, profileWindow, target * 0.35, MIN_BUDGET_TOLERANCE);
}

function deriveMaxBudget(filter: UserFilter): number | null {
  if (filter.budget_max) return filter.budget_max;
  if (filter.price_max) return filter.price_max;
  if (filter.budget) return filter.budget * 1.2;
  return null;
}

function toArray(value: StringOrStringArray): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return [String(value)].filter(Boolean);
}

function normalizeKey(value?: string | null): string {
  if (!value) return '';
  return value.toLowerCase().trim();
}

function normalizeCategory(value: string): string {
  const normalized = normalizeKey(value);
  if (normalized.includes('suv')) return 'suv';
  if (normalized.includes('truck')) return 'truck';
  if (normalized.includes('mini')) return 'minivan';
  if (normalized.includes('cross')) return 'crossover';
  if (normalized.includes('sedan') || normalized.includes('car')) return 'car';
  return normalized;
}

function colorsRoughlyMatch(target: string, actual: string) {
  const baseTarget = normalizeColorLabel(target);
  const baseActual = normalizeColorLabel(actual);
  if (baseTarget === baseActual) return true;
  const groups = [
    ['black', 'midnight', 'graphite'],
    ['white', 'pearl', 'cream'],
    ['gray', 'silver', 'gunmetal'],
    ['red', 'burgundy', 'crimson'],
    ['blue', 'navy', 'steel'],
    ['green', 'olive', 'forest'],
    ['brown', 'bronze', 'beige', 'tan'],
    ['gold', 'yellow', 'champagne'],
  ];
  return groups.some(group => group.includes(baseTarget) && group.includes(baseActual));
}

function normalizeColorLabel(value: string | undefined): string {
  if (!value) return '';
  const normalized = value.toLowerCase().replace(/[^a-z]/g, ' ').trim();
  const tokens = normalized.split(/\s+/);
  const palette = ['black', 'white', 'gray', 'silver', 'red', 'blue', 'green', 'gold', 'yellow', 'orange', 'brown', 'beige', 'tan', 'cream', 'purple'];
  for (const color of palette) {
    if (tokens.includes(color)) return color;
  }
  return tokens[0] || normalized;
}

function buildModelQueries(filter: UserFilter): string[] {
  const explicit = toArray(filter.model);
  const keywords = filter.model_keywords || [];
  return [...explicit, ...keywords].map(normalizeKey).filter(Boolean);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function bumpAttribute(counter: Record<string, number>, value?: string | null) {
  const key = normalizeKey(value);
  if (!key) return;
  counter[key] = (counter[key] || 0) + 1;
}

function bumpNumeric(counter: Record<number, number>, value?: number | null) {
  if (value == null) return;
  counter[value] = (counter[value] || 0) + 1;
}

function updateBudgetStats(profile: UserProfile, newValue: number) {
  const count = profile.budgetSampleCount + 1;
  const delta = newValue - (profile.budgetMean ?? 0);
  const mean = (profile.budgetMean ?? 0) + delta / count;
  const delta2 = newValue - mean;
  const m2 = profile.budgetM2 + delta * delta2;
  profile.budgetSampleCount = count;
  profile.budgetMean = mean;
  profile.budgetM2 = m2;
  profile.budgetStdDev = count > 1 ? Math.sqrt(Math.max(m2 / (count - 1), 0)) : 0;
}

function topKeys(counter: Record<string, number>, limit: number) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

function formatCurrency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export type FeedbackPayload = {
  sessionId: string;
  listing: Car;
  feedback: 'like' | 'reject';
};
