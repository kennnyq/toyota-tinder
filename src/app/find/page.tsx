'use client';
import NavBar from '@/components/NavBar';
import { useLoadingOverlay } from '@/components/LoadingOverlayProvider';
import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Preferences, AnalyzeResponse, UserFilter, FuelPreference, BodyStylePreference } from '@/lib/types';
import { saveResults, saveUserFilter } from '@/lib/likes';
import { AnimatePresence, motion } from 'framer-motion';
import { deriveNoteConstraints } from '@/lib/util';

const LOADING_STEPS = [
  'Locking in your price window + condition…',
  'Sweeping dealer feeds for the body styles you tapped…',
  'Applying year and mileage guardrails…',
  'Matching MPG + fuel-type requests to each lead…',
  'Scoring Toyotas and packing the swipe deck…',
] as const;
const MIN_LOADING_MS = 1200;
const SUCCESS_DEMO_DELAY_MS = 850;
const STEP_BASE_MS = 1400;
const STEP_JITTER_MS = 350;
const CONDITION_OPTIONS: Preferences['used'][] = ['Any', 'New', 'Used'];
const BODY_TYPE_OPTIONS = ['SUV', 'Sedan', 'Truck', 'Minivan', 'Hatchback', 'Wagon', 'Coupe'] as const;
const FUEL_TYPE_OPTIONS = ['Gas', 'Hybrid', 'Electric'] as const;
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_ZIP = '75080';
const INITIAL_RECOMMENDATION_LIMIT = 30;
type SectionKey = 'price' | 'body' | 'efficiency';

const FORM_VARIANTS = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.35,
      ease: [0.22, 1, 0.36, 1],
      delayChildren: 0.04,
      staggerChildren: 0.07,
    },
  },
  loading: { opacity: 0.6, y: 0 },
} as const;

const HEADING_VARIANTS = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
} as const;

const CARD_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: 'easeOut', staggerChildren: 0.05 },
  },
} as const;

const STACK_VARIANTS = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const FIELD_VARIANTS = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
} as const;

export default function FindPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    price: true,
    body: false,
    efficiency: false,
  });
  const sequenceControllerRef = useRef<AbortController | null>(null);
  const overlayShouldPersistRef = useRef(false);
  const { showOverlay, updateOverlayMessage, hideOverlay } = useLoadingOverlay();
  const currentLoadingMessage = LOADING_STEPS[Math.min(activeStep, LOADING_STEPS.length - 1)];

  useEffect(() => () => {
    sequenceControllerRef.current?.abort();
  }, []);

  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (loading && !prevLoadingRef.current) {
      showOverlay(currentLoadingMessage);
    } else if (!loading && prevLoadingRef.current) {
      if (!overlayShouldPersistRef.current) {
        hideOverlay();
      }
    }
    prevLoadingRef.current = loading;
  }, [loading, showOverlay, hideOverlay, currentLoadingMessage]);

  useEffect(() => {
    if (!loading) return;
    updateOverlayMessage(currentLoadingMessage);
  }, [loading, currentLoadingMessage, updateOverlayMessage]);

  useEffect(() => () => {
    if (overlayShouldPersistRef.current) return;
    hideOverlay();
  }, [hideOverlay]);

  const toggleSection = (key: SectionKey) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const runLoadingSequence = useCallback(async (signal: AbortSignal) => {
    for (let i = 0; i < LOADING_STEPS.length; i += 1) {
      if (signal.aborted) throw createAbortError();
      setActiveStep(i);
      const isLast = i === LOADING_STEPS.length - 1;
      if (!isLast) {
        const delay = STEP_BASE_MS + Math.random() * STEP_JITTER_MS;
        await sleep(delay, signal);
      }
    }
  }, []);

  const beginSequence = useCallback(() => {
    sequenceControllerRef.current?.abort();
    const controller = new AbortController();
    sequenceControllerRef.current = controller;
    const promise = runLoadingSequence(controller.signal)
      .catch(err => {
        if (err?.name !== 'AbortError') throw err;
      })
      .finally(() => {
        if (sequenceControllerRef.current === controller) {
          sequenceControllerRef.current = null;
        }
      });
    return promise as Promise<void>;
  }, [runLoadingSequence]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const bodyTypes = fd.getAll('bodyTypes').map(value => value.toString()) as Preferences['bodyTypes'];
    const fuelTypes = fd.getAll('fuelTypes').map(value => value.toString()) as Preferences['fuelTypes'];
    const prefs: Preferences = {
      zipCode: parseZip(fd.get('zipCode')),
      priceMin: parseFormNumber(fd.get('priceMin')),
      priceMax: parseFormNumber(fd.get('priceMax')),
      used: (fd.get('used') as Preferences['used'] | null) ?? 'Any',
      bodyTypes,
      yearMin: parseFormNumber(fd.get('yearMin')),
      yearMax: parseFormNumber(fd.get('yearMax')),
      mileageMin: parseFormNumber(fd.get('mileageMin')),
      mileageMax: parseFormNumber(fd.get('mileageMax')),
      seatsMin: parseFormNumber(fd.get('seatsMin')),
      seatsMax: parseFormNumber(fd.get('seatsMax')),
      fuelTypes,
      mpgMin: parseFormNumber(fd.get('mpgMin')),
      mpgMax: parseFormNumber(fd.get('mpgMax')),
      notes: String(fd.get('notes') || '').trim(),
    };
    setLoading(true);
    const sequencePromise = beginSequence();
    const startedAt = Date.now();
    let shouldResetLoading = true;
    try {
      const userFilter = preferencesToUserFilter(prefs);
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prefs, limit: INITIAL_RECOMMENDATION_LIMIT }),
      });
      if (!res.ok) throw new Error('Failed to analyze preferences');
      const data: AnalyzeResponse = await res.json();
      if (!Array.isArray(data.cars)) throw new Error('Analyze response malformed');
      saveResults(data.cars, {
        warning: data.warning,
        reasoning: data.reasoning,
      });
      saveUserFilter(userFilter);
      await Promise.all([
        sequencePromise,
        sleep(SUCCESS_DEMO_DELAY_MS),
      ]);
      overlayShouldPersistRef.current = true;
      setLoading(false);
      router.push('/swipe');
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          hideOverlay(() => {
            overlayShouldPersistRef.current = false;
          });
        }, 150);
      } else {
        hideOverlay(() => {
          overlayShouldPersistRef.current = false;
        });
      }
      shouldResetLoading = false;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message || 'Something went wrong');
    } finally {
      if (shouldResetLoading) {
        sequenceControllerRef.current?.abort();
        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_LOADING_MS) {
          await sleep(MIN_LOADING_MS - elapsed);
        }
        setLoading(false);
      }
    }
  }

  return (
    <main>
      <NavBar />
      <motion.section
        className="mx-auto max-w-3xl px-4 pt-12 pb-24"
        initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.h1
          className="text-3xl font-bold"
          variants={HEADING_VARIANTS}
          initial="hidden"
          animate="show"
        >
          Your preferences
        </motion.h1>
        <div className="relative mt-6">
          <motion.form
            onSubmit={onSubmit}
            className="flex flex-col gap-6"
            variants={FORM_VARIANTS}
            initial="hidden"
            animate={loading ? 'loading' : 'show'}
            aria-busy={loading}
          >
          <motion.section className="card space-y-5" variants={CARD_VARIANTS}>
            <motion.div className="space-y-4" variants={STACK_VARIANTS}>
              <motion.div variants={FIELD_VARIANTS}>
                <PreferenceSection
                  id="price"
                  title="Price & condition"
                  isOpen={openSections.price}
                  onToggle={toggleSection}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="label" htmlFor="priceMin">Price from</label>
                        <div className="relative">
                          <span className="input-prefix">$</span>
                          <input className="input input--with-prefix" id="priceMin" name="priceMin" type="number" min={0} step={1} placeholder="30000" />
                        </div>
                      </div>
                      <div>
                        <label className="label" htmlFor="priceMax">Price to</label>
                        <div className="relative">
                          <span className="input-prefix">$</span>
                          <input className="input input--with-prefix" id="priceMax" name="priceMax" type="number" min={0} step={1} placeholder="50000" />
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="label mb-2">Condition</p>
                      <div role="group" aria-label="Condition options" className="flex flex-wrap gap-2">
                        {CONDITION_OPTIONS.map(option => (
                          <label key={option} className="cursor-pointer">
                            <input className="sr-only peer" type="radio" name="used" value={option} defaultChecked={option === 'Any'} />
                            <span className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-red-200 peer-checked:border-red-300 peer-checked:bg-red-50 peer-checked:text-red-600">
                              {option}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </PreferenceSection>
              </motion.div>

              <motion.div variants={FIELD_VARIANTS}>
                <PreferenceSection
                  id="body"
                  title="Body style, year & seating"
                  isOpen={openSections.body}
                  onToggle={toggleSection}
                >
                  <div className="space-y-4">
                    <div>
                      <p className="label mb-2">Body type</p>
                      <div role="group" aria-label="Body type options" className="flex flex-wrap gap-2">
                        {BODY_TYPE_OPTIONS.map(type => (
                          <label key={type} className="cursor-pointer">
                            <input className="sr-only peer" type="checkbox" name="bodyTypes" value={type} />
                            <span className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-red-200 peer-checked:border-red-300 peer-checked:bg-red-50 peer-checked:text-red-600">
                              {type}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="label" htmlFor="yearMin">Year from</label>
                        <input className="input" id="yearMin" name="yearMin" type="number" min={2008} max={CURRENT_YEAR} placeholder="2018" />
                      </div>
                      <div>
                        <label className="label" htmlFor="yearMax">Year to</label>
                        <input className="input" id="yearMax" name="yearMax" type="number" min={2008} max={CURRENT_YEAR} placeholder={CURRENT_YEAR.toString()} />
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="label" htmlFor="seatsMin">Seats from</label>
                        <input className="input" id="seatsMin" name="seatsMin" type="number" min={2} max={9} placeholder="5" />
                      </div>
                      <div>
                        <label className="label" htmlFor="seatsMax">Seats to</label>
                        <input className="input" id="seatsMax" name="seatsMax" type="number" min={2} max={9} placeholder="8" />
                      </div>
                    </div>
                  </div>
                </PreferenceSection>
              </motion.div>

              <motion.div variants={FIELD_VARIANTS}>
                <PreferenceSection
                  id="efficiency"
                  title="Mileage, fuel & MPG"
                  isOpen={openSections.efficiency}
                  onToggle={toggleSection}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="label" htmlFor="mileageMin">Mileage from</label>
                        <input className="input" id="mileageMin" name="mileageMin" type="number" min={0} step={5000} placeholder="15000" />
                      </div>
                      <div>
                        <label className="label" htmlFor="mileageMax">Mileage to</label>
                        <input className="input" id="mileageMax" name="mileageMax" type="number" min={0} step={5000} placeholder="60000" />
                      </div>
                    </div>
                    <div>
                      <p className="label mb-2">Fuel type</p>
                      <div role="group" aria-label="Fuel type options" className="flex flex-wrap gap-2">
                        {FUEL_TYPE_OPTIONS.map(type => (
                          <label key={type} className="cursor-pointer">
                            <input className="sr-only peer" type="checkbox" name="fuelTypes" value={type} />
                            <span className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-red-200 peer-checked:border-red-300 peer-checked:bg-red-50 peer-checked:text-red-600">
                              {type}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="label" htmlFor="mpgMin">MPG from</label>
                        <input className="input" id="mpgMin" name="mpgMin" type="number" min={0} max={80} placeholder="30" />
                      </div>
                      <div>
                        <label className="label" htmlFor="mpgMax">MPG to</label>
                        <input className="input" id="mpgMax" name="mpgMax" type="number" min={0} max={80} placeholder="45" />
                      </div>
                    </div>
                    <div>
                      <label className="label" htmlFor="zipCode">Your zip code</label>
                      <div className="grid gap-2 md:grid-cols-[160px]">
                        <input
                          className="input md:max-w-xs"
                          id="zipCode"
                          name="zipCode"
                          type="text"
                          inputMode="numeric"
                          pattern="\\d{5}"
                          placeholder={DEFAULT_ZIP}
                          maxLength={5}
                        />
                      </div>
                    </div>
                  </div>
                </PreferenceSection>
              </motion.div>
            </motion.div>

            <motion.div variants={FIELD_VARIANTS}>
              <label className="label" htmlFor="notes">What else should we know?</label>
              <textarea
                className="textarea"
                id="notes"
                name="notes"
                rows={4}
                placeholder="Give a large, spacious family car that would be good for roadtrips."
              />
            </motion.div>
          </motion.section>

          <motion.div className="flex flex-col items-center gap-2 text-center" variants={FIELD_VARIANTS}>
            <button disabled={loading} className="btn btn-primary px-8" type="submit">
              {loading ? 'Analyzing…' : 'Find Matches'}
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </motion.div>
          </motion.form>
          <AnimatePresence>
            {loading && (
              <motion.div
                key="form-loading"
                className="pointer-events-none absolute inset-0 rounded-[32px] bg-white/70 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                aria-hidden="true"
              />
            )}
          </AnimatePresence>
        </div>
      </motion.section>
    </main>
  );
}

type PreferenceSectionProps = {
  id: SectionKey;
  title: string;
  isOpen: boolean;
  onToggle: (key: SectionKey) => void;
  children: ReactNode;
};

function PreferenceSection({ id, title, isOpen, onToggle, children }: PreferenceSectionProps) {
  const contentId = `${id}-content`;
  return (
    <div className="w-full rounded-2xl border border-slate-200/80 bg-white/80 px-5 py-4 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-6 text-left"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={contentId}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function sleep(ms: number, signal?: AbortSignal) {
  if (!signal) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
  }

  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function createAbortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function parseFormNumber(value: FormDataEntryValue | null) {
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseZip(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{5}$/.test(trimmed)) return trimmed;
  return null;
}

function preferencesToUserFilter(prefs: Preferences): UserFilter {
  const noteConstraints = deriveNoteConstraints(prefs.notes);
  const noteFuel = mapPreferredFuelToFilter(noteConstraints.preferredFuel);
  const fuelTypes = dedupeStrings([
    ...prefs.fuelTypes,
    ...(noteFuel ? [noteFuel] : []),
  ]);
  const noteCategories = (noteConstraints.preferredCategories || [])
    .map(mapNoteCategoryToBodyType)
    .filter(
      (value): value is BodyStylePreference => Boolean(value),
    );
  const vehicleCategories = dedupeStrings([
    ...prefs.bodyTypes,
    ...noteCategories,
  ]);
  const seatsMin = harmonizeMinimum(prefs.seatsMin, noteConstraints.minSeating);
  const mileageMax = harmonizeMaximum(
    prefs.mileageMax,
    noteConstraints.maxMileage,
  );

  return {
    budget_min: prefs.priceMin ?? null,
    budget_max: prefs.priceMax ?? null,
    price_min: prefs.priceMin ?? null,
    price_max: prefs.priceMax ?? null,
    year_min: prefs.yearMin ?? null,
    year_max: prefs.yearMax ?? null,
    mileage_min: prefs.mileageMin ?? null,
    mileage_max: mileageMax,
    available_seating: seatsMin,
    fuel_type: fuelTypes.length ? fuelTypes : undefined,
    vehicle_category: vehicleCategories.length ? vehicleCategories : undefined,
    drivetrain: noteConstraints.requiresAwd ? ['AWD', '4WD'] : undefined,
    notes: prefs.notes,
    condition: prefs.used === 'Any' ? undefined : prefs.used.toLowerCase(),
  } satisfies UserFilter;
}

function dedupeStrings<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean))) as T[];
}

function mapPreferredFuelToFilter(value?: string | null): FuelPreference | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'hybrid') return 'Hybrid';
  if (normalized === 'electric') return 'Electric';
  if (normalized === 'gas') return 'Gas';
  return null;
}

function mapNoteCategoryToBodyType(value?: string | null): BodyStylePreference | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes('suv')) return 'SUV';
  if (normalized.includes('truck')) return 'Truck';
  if (normalized.includes('van')) return 'Minivan';
  if (normalized.includes('crossover')) return 'Crossover';
  if (normalized.includes('wagon')) return 'Wagon';
  if (normalized.includes('coupe')) return 'Coupe';
  if (normalized.includes('sedan') || normalized.includes('car')) return 'Sedan';
  return null;
}

function harmonizeMinimum(a?: number | null, b?: number | null) {
  const aVal = typeof a === 'number' && Number.isFinite(a) ? a : null;
  const bVal = typeof b === 'number' && Number.isFinite(b) ? b : null;
  if (aVal != null && bVal != null) return Math.max(aVal, bVal);
  if (aVal != null) return aVal;
  if (bVal != null) return bVal;
  return null;
}

function harmonizeMaximum(a?: number | null, b?: number | null) {
  const aVal = typeof a === 'number' && Number.isFinite(a) ? a : null;
  const bVal = typeof b === 'number' && Number.isFinite(b) ? b : null;
  if (aVal != null && bVal != null) return Math.min(aVal, bVal);
  if (aVal != null) return aVal;
  if (bVal != null) return bVal;
  return null;
}
