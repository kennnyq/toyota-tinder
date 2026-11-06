import { NextResponse } from 'next/server';
import { AnalyzeResponse, Car, Preferences } from '@/lib/types';
import { filterCars, pickTopN, orderCarsForDisplay, deriveNoteConstraints, describeNoteConstraints } from '@/lib/util';
import { GoogleGenAI } from '@google/genai';
import { getCsvCars } from '@/data/csvCars.server';
import { clientKeyFromRequest, tryConsumeGeminiCall } from '@/server/geminiRateLimit';
import { normalizeZipCode, getZipCoordinates, getDealerLocation, computeDistanceMiles, Coordinates } from '@/lib/location';

const DEFAULT_RESULT_LIMIT = 10;
const MAX_RESULT_LIMIT = 40;
type AnalyzePayload = Preferences & { limit?: number };
type GeminiResponse = { text?: string | null };
type LegacyGeminiClient = GoogleGenAI & {
  models?: { generateContent?: (input: unknown) => Promise<GeminiResponse> };
  generate?: (input: unknown) => Promise<GeminiResponse>;
  responses?: { generate?: (input: unknown) => Promise<GeminiResponse> };
};

function normalizeLimit(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RESULT_LIMIT;
  const whole = Math.floor(value);
  if (whole < 1) return 1;
  if (whole > MAX_RESULT_LIMIT) return MAX_RESULT_LIMIT;
  return whole;
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as AnalyzePayload;
    const { limit: requestedLimit, ...prefs } = payload;
    const limit = normalizeLimit(requestedLimit);
    const key = (process.env.GEMINI_API_KEY || '').trim();
    const cars = getCsvCars();
    const filtered = filterCars(cars, prefs);
    const fallbackBase = filtered.length ? filtered : cars;
    const noteConstraints = deriveNoteConstraints(prefs.notes);

    if (!key) {
      // Fallback: sample filtered (or entire dataset if empty), pick up to limit
      const sampled = orderCarsForDisplay(sampleRandom(fallbackBase, limit), prefs);
      const res: AnalyzeResponse = {
        cars: decorateCarsForClient(sampled, prefs),
        warning: 'Server missing GEMINI_API_KEY. Showing a randomized filtered selection instead.',
      };
      return NextResponse.json(res);
    }

    if (!tryConsumeGeminiCall(clientKeyFromRequest(req))) {
      const chosen = orderCarsForDisplay(pickTopN(fallbackBase, prefs, limit), prefs);
      return NextResponse.json({
        cars: decorateCarsForClient(chosen, prefs),
        warning: 'AI matching is rate limited right now. Showing heuristic results instead.',
      });
    }

    // With key: use new @google/genai client to choose the best up to 10 by ID
    const ai = new GoogleGenAI({ apiKey: key });
    const legacyClient = ai as LegacyGeminiClient;
    const { promptCars, totalMatches } = getPromptDataset(filtered, cars, prefs);
    const prompt = buildPrompt(prefs, promptCars, totalMatches, describeNoteConstraints(noteConstraints), limit);

    let text = '';
    try {
      let response: GeminiResponse | null = null;
      if (typeof legacyClient.models?.generateContent === 'function') {
        response = await legacyClient.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { temperature: 0.2, responseMimeType: 'application/json' },
        });
      } else if (typeof legacyClient.generate === 'function') {
        response = await legacyClient.generate({
          model: 'gemini-2.5-flash',
          prompt,
          temperature: 0.2,
        });
      } else if (typeof legacyClient.responses?.generate === 'function') {
        response = await legacyClient.responses.generate({
          model: 'gemini-2.5-flash',
          input: prompt,
        });
      } else {
        throw new Error('Unsupported Gemini client API');
      }
      text = response?.text ?? '';
    } catch (error) {
      console.error('Gemini generateContent failed', error);
      const chosen = orderCarsForDisplay(pickTopN(fallbackBase, prefs, limit), prefs);
      return NextResponse.json({
        cars: decorateCarsForClient(chosen, prefs),
        warning: 'Gemini request failed. Using heuristic results.',
      });
    }

    console.log('Gemini response text:', text);

    let ids: number[] = [];
    let reasoning = '';
    let descriptions: Record<string, string> = {};
    try {
      const parsed = JSON.parse(text || '{}');
      ids = parsed.ids as number[];
      reasoning = parsed.reasoning || '';
      if (parsed.descriptions && typeof parsed.descriptions === 'object') {
        descriptions = parsed.descriptions as Record<string, string>;
      }
    } catch {
      const chosen = orderCarsForDisplay(pickTopN(fallbackBase, prefs, limit), prefs);
      return NextResponse.json({
        cars: decorateCarsForClient(chosen, prefs),
        warning: 'Gemini response could not be parsed. Using heuristic results.',
      });
    }

    const map = new Map<number, Car>();
    cars.forEach(c => map.set(c.Id, c));
    const selected: Car[] = ids.map((id: number) => map.get(id)).filter(Boolean) as Car[];

    // Safety: if Gemini returned nothing, fallback to heuristic top N
    const finalCars = selected.length ? selected.slice(0, limit) : pickTopN(fallbackBase, prefs, limit);
    const orderedCars = orderCarsForDisplay(finalCars, prefs);

    const res: AnalyzeResponse = {
      cars: decorateCarsForClient(orderedCars, prefs, descriptions),
      reasoning,
    };
    return NextResponse.json(res);
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Analyze failed', details: message }, { status: 500 });
  }
}

const PROMPT_ROW_LIMIT = 75;
const PROMPT_HEADER = [
  'Id',
  'Model',
  'Year',
  'Price',
  'Mileage',
  'Fuel',
  'Condition',
  'Type',
  'Dealer',
  'DistanceMi',
  'Engine',
  'Transmission',
  'Drivetrain',
  'MPG',
  'ExteriorColor',
  'InteriorColor',
  'Seats',
  'VehicleCategory',
] as const;

function getPromptDataset(filtered: Car[], all: Car[], prefs: Preferences) {
  if (filtered.length) {
    const subset = filtered.length > PROMPT_ROW_LIMIT ? pickTopN(filtered, prefs, PROMPT_ROW_LIMIT) : filtered;
    return {
      promptCars: subset,
      totalMatches: filtered.length,
    };
  }
  const ranked = pickTopN(all, prefs, PROMPT_ROW_LIMIT * 3);
  return {
    promptCars: ranked.slice(0, PROMPT_ROW_LIMIT),
    totalMatches: all.length,
  };
}

function buildPrompt(prefs: Preferences, cars: Car[], totalMatches: number, noteSummary: string, limit: number) {
  const csv = carsToCsv(cars);
  const shown = Math.min(cars.length, PROMPT_ROW_LIMIT);
  const guardrails = formatGuardrailLines(prefs);
  const notes = prefs.notes?.trim() ? prefs.notes.trim() : 'No additional notes provided.';
  return [
    `You are a Toyota inventory matchmaker. Analyze the CSV data below and choose up to ${limit} listings that best satisfy the user preferences and chat notes.`,
    'Respect these structured guardrails before applying your own desirability ranking:',
    guardrails,
    `Derived note constraints: ${noteSummary}`,
    `User chat notes to reference when writing descriptions: ${notes}`,
    'User preferences (JSON):',
    JSON.stringify(prefs),
    `Only pick Ids that exist in the CSV rows (showing ${shown} of ${totalMatches} matching records).`,
    `Respond with strict JSON (max ${limit} ids): {"ids":[<Id numbers>],"descriptions":{"<Id>":"1-2 sentence reason referencing user notes"},"reasoning":"concise summary"}`,
    '',
    'CSV:',
    csv,
  ].join('\n');
}

function formatGuardrailLines(prefs: Preferences) {
  const lines: string[] = [];
  const priceLine = formatPriceGuardrail(prefs.priceMin, prefs.priceMax);
  if (priceLine) lines.push(`• ${priceLine}`);
  if (prefs.used !== 'Any') lines.push(`• Condition: ${prefs.used} inventory only`);
  if (prefs.bodyTypes.length) lines.push(`• Body styles prioritized: ${prefs.bodyTypes.join(', ')}`);
  const yearLine = formatRangeText('Model years', prefs.yearMin, prefs.yearMax);
  if (yearLine) lines.push(`• ${yearLine}`);
  const mileageLine = formatRangeText('Mileage', prefs.mileageMin, prefs.mileageMax, 'miles');
  if (mileageLine) lines.push(`• ${mileageLine}`);
  const seatingLine = formatRangeText('Seating', prefs.seatsMin, prefs.seatsMax, 'passengers');
  if (seatingLine) lines.push(`• ${seatingLine}`);
  if (prefs.fuelTypes.length) lines.push(`• Fuel preference: ${prefs.fuelTypes.join(', ')}`);
  const mpgLine = formatRangeText('MPG target', prefs.mpgMin, prefs.mpgMax);
  if (mpgLine) lines.push(`• ${mpgLine}`);
  return lines.length
    ? lines.join('\n')
    : '• No strict guardrails were provided beyond overall Toyota desirability.';
}

function formatPriceGuardrail(min?: number | null, max?: number | null) {
  const minText = formatUsd(min);
  const maxText = formatUsd(max);
  if (minText && maxText) return `Price window: $${minText} - $${maxText}`;
  if (maxText) return `Price cap: at or below $${maxText}`;
  if (minText) return `Price floor: at or above $${minText}`;
  return '';
}

function formatRangeText(label: string, min?: number | null, max?: number | null, unit?: string) {
  const minHas = hasValue(min);
  const maxHas = hasValue(max);
  if (!minHas && !maxHas) return '';
  const unitSuffix = unit ? ` ${unit}` : '';
  if (minHas && maxHas) return `${label} between ${formatNumber(min!)} and ${formatNumber(max!)}${unitSuffix}`;
  if (minHas) return `${label} at or above ${formatNumber(min!)}${unitSuffix}`;
  return `${label} at or below ${formatNumber(max!)}${unitSuffix}`;
}

function formatUsd(value?: number | null) {
  return hasValue(value) ? formatNumber(value!) : '';
}

function formatNumber(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function hasValue(value?: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function describePriceFragment(prefs: Preferences) {
  const minText = formatUsd(prefs.priceMin);
  const maxText = formatUsd(prefs.priceMax);
  if (minText && maxText) return `within your $${minText}-$${maxText} window`;
  if (maxText) return `under your $${maxText} cap`;
  if (minText) return `above your $${minText} floor`;
  return '';
}

function carsToCsv(cars: Car[]) {
  const lines = cars.map(car => PROMPT_HEADER.map(col => encodeCsvValue(getCarField(car, col))).join(','));
  return [PROMPT_HEADER.join(','), ...lines].join('\n');
}

function getCarField(car: Car, column: typeof PROMPT_HEADER[number]) {
  switch (column) {
    case 'Id': return car.Id;
    case 'Model': return car.Model;
    case 'Year': return car.Year;
    case 'Price': return car.Price;
    case 'Mileage': return car.Mileage;
    case 'Fuel': return car['Fuel Type'] || car.FuelType;
    case 'Condition': return car.Condition;
    case 'Type': return car.Type;
    case 'Dealer': return car.Dealer || car.Location;
    case 'DistanceMi': return car.DistanceMiles;
    case 'Engine': return car.Engine;
    case 'Transmission': return car.Transmission;
    case 'Drivetrain': return car.Drivetrain;
    case 'MPG': return car.MPG;
    case 'ExteriorColor': return car.ExteriorColor;
    case 'InteriorColor': return car.InteriorColor;
    case 'Seats': return car.Seating;
    case 'VehicleCategory': return car.VehicleCategory || car.Type;
    default: return '';
  }
}

function encodeCsvValue(value: unknown) {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'number' ? Number(value).toString() : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function sampleRandom(cars: Car[], count: number) {
  if (cars.length <= count) return [...cars];
  const picked = new Set<number>();
  const results: Car[] = [];
  while (results.length < count && picked.size < cars.length) {
    const idx = Math.floor(Math.random() * cars.length);
    if (picked.has(idx)) continue;
    picked.add(idx);
    results.push(cars[idx]);
  }
  return results;
}

const DEFAULT_IMAGE_URL = '/car-placeholder.svg';

function decorateCarsForClient(cars: Car[], prefs: Preferences, descriptions?: Record<string, string>) {
  const userZip = normalizeZipCode(prefs.zipCode);
  const homeCoords = getZipCoordinates(userZip);
  return cars.map(car => {
    const carId = String(car.Id);
    const provided = descriptions?.[carId];
    const enriched = attachDealerMetadata(car, userZip, homeCoords);
    return {
      ...enriched,
      ImageUrl: enriched.ImageUrl || DEFAULT_IMAGE_URL,
      FitDescription: buildFallbackDescription(enriched, prefs, provided),
    };
  });
}

function attachDealerMetadata(car: Car, userZip: string, homeCoords: Coordinates | null): Car {
  const dealerDetails = getDealerLocation(car.Dealer);
  const computedDistance = dealerDetails && homeCoords ? computeDistanceMiles(homeCoords, dealerDetails.coordinates) : undefined;
  const fallbackDistance = typeof car.DistanceMiles === 'number' ? car.DistanceMiles : undefined;
  const finalDistance = typeof computedDistance === 'number' ? computedDistance : fallbackDistance;

  const dealerCity = dealerDetails?.city ?? car.DealerCity;
  const dealerState = dealerDetails?.state ?? car.DealerState;
  const dealerZip = dealerDetails?.zip ?? car.DealerZip;

  const hasDealerMeta = Boolean(dealerDetails || dealerCity || dealerState);
  const locationLabel = hasDealerMeta || typeof finalDistance === 'number'
    ? buildDealerLocationLabel(car.Dealer || 'Toyota dealer', dealerCity, dealerState, finalDistance)
    : (car.Location || car.Dealer || 'Toyota dealer');

  return {
    ...car,
    Location: locationLabel,
    DistanceMiles: finalDistance,
    DealerCity: dealerCity,
    DealerState: dealerState,
    DealerZip: dealerZip,
    UserZip: userZip,
    DistanceLabel: typeof finalDistance === 'number' ? formatDistance(finalDistance) : undefined,
  };
}

function buildDealerLocationLabel(name: string, city?: string, state?: string, distance?: number) {
  const labelParts = [name.trim()];
  if (city && state) {
    labelParts.push(`${city}, ${state}`);
  } else if (city) {
    labelParts.push(city);
  }
  if (typeof distance === 'number' && Number.isFinite(distance)) {
    labelParts.push(formatDistance(distance));
  }
  return labelParts.join(' · ');
}

function formatDistance(distance: number) {
  return `${distance.toFixed(1)} mi away`;
}

function buildFallbackDescription(car: Car, prefs: Preferences, provided?: string) {
  if (provided && provided.trim()) return provided.trim();
  const notes = (prefs.notes || '').trim();
  const intro = notes ? `You mentioned "${notes}", so` : 'This pick';
  const mileage = typeof car.Mileage === 'number'
    ? `${car.Mileage.toLocaleString()} miles on the odometer`
    : 'dealer-reported mileage that will need confirming';
  const fuel = car['Fuel Type'] || car.FuelType || 'versatile fuel setup';
  const dealer = car.Dealer ? ` at ${car.Dealer}` : '';
  const priceFragment = describePriceFragment(prefs);
  const budgetLine = priceFragment ? ` It stays ${priceFragment}.` : '';
  return `${intro} the ${car.Year} ${car.Model}${dealer} delivers ${mileage}, ${fuel.toLowerCase()} efficiency, and daily comfort that aligns with your priorities.${budgetLine}`;
}
