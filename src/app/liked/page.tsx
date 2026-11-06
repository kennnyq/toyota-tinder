'use client';
import CarDetailModal from '@/components/CarDetailModal';
import NavBar from '@/components/NavBar';
import { AprDealsLink, AprInfoIcon } from '@/components/AprInfo';
import { formatCurrency, getCategory } from '@/lib/carDisplay';
import { getLikedCars, clearLikes } from '@/lib/likes';
import { useEffect, useMemo, useState, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Car } from '@/lib/types';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';

type SortKey = 'az' | 'price-asc' | 'price-desc' | 'mpg-asc' | 'mpg-desc';

const MODAL_ANIMATION_MS = 240;
const CURRENT_YEAR = new Date().getFullYear();
const CONDITION_OPTIONS = ['Any', 'New', 'Used'] as const;
const FUEL_TYPE_OPTIONS = ['Gas', 'Hybrid', 'Electric'] as const;
type ConditionFilter = typeof CONDITION_OPTIONS[number];
type FuelFilter = typeof FUEL_TYPE_OPTIONS[number];
const CHILD_FADE_VARIANTS = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
} as const;

export default function LikedPage() {
  const [cars, setCars] = useState<Car[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('az');
  const [priceRange, setPriceRange] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>('Any');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [seatsMin, setSeatsMin] = useState('');
  const [seatsMax, setSeatsMax] = useState('');
  const [mileageMin, setMileageMin] = useState('');
  const [mileageMax, setMileageMax] = useState('');
  const [selectedFuelTypes, setSelectedFuelTypes] = useState<FuelFilter[]>([]);
  const [mpgMin, setMpgMin] = useState('');
  const [mpgMax, setMpgMax] = useState('');
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  const [isModalVisible, setModalVisible] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      setCars(getLikedCars());
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  const priceLimits = useMemo(() => {
    if (!cars.length) return { min: 0, max: 0 };
    const prices = cars.map(car => car.Price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      min: roundDownToThousand(min),
      max: roundUpToThousand(max),
    };
  }, [cars]);

  const typeOptions = useMemo(() => countByCategory(cars), [cars]);

  const filteredCars = useMemo(() => {
    if (!cars.length) return [];
    const yearMinValue = parseNumberInput(yearMin);
    const yearMaxValue = parseNumberInput(yearMax);
    const seatsMinValue = parseNumberInput(seatsMin);
    const seatsMaxValue = parseNumberInput(seatsMax);
    const mileageMinValue = parseNumberInput(mileageMin);
    const mileageMaxValue = parseNumberInput(mileageMax);
    const mpgMinValue = parseNumberInput(mpgMin);
    const mpgMaxValue = parseNumberInput(mpgMax);

    return cars.filter(car => {
      const category = getCategory(car);
      const seat = typeof car.Seating === 'number' ? car.Seating : null;
      const mileage = typeof car.Mileage === 'number' ? car.Mileage : null;
      const carYear = typeof car.Year === 'number' ? car.Year : null;
      const averageMpg = getAverageMpg(car);
      const fuelCategory = getFuelCategory(car);

      const matchesType = !selectedTypes.length || selectedTypes.includes(category);

      const matchesCondition =
        conditionFilter === 'Any' ||
        (conditionFilter === 'New' ? !car.Used : car.Used);

      const matchesYear = (() => {
        if (yearMinValue === null && yearMaxValue === null) return true;
        if (carYear === null) return false;
        if (yearMinValue !== null && carYear < yearMinValue) return false;
        if (yearMaxValue !== null && carYear > yearMaxValue) return false;
        return true;
      })();

      const matchesSeatsRange = (() => {
        if (seatsMinValue === null && seatsMaxValue === null) return true;
        if (seat === null) return false;
        if (seatsMinValue !== null && seat < seatsMinValue) return false;
        if (seatsMaxValue !== null && seat > seatsMaxValue) return false;
        return true;
      })();

      const matchesMileage = (() => {
        if (mileageMinValue === null && mileageMaxValue === null) return true;
        if (mileage === null) return false;
        if (mileageMinValue !== null && mileage < mileageMinValue) return false;
        if (mileageMaxValue !== null && mileage > mileageMaxValue) return false;
        return true;
      })();

      const matchesFuel = !selectedFuelTypes.length || selectedFuelTypes.includes(fuelCategory);

      const matchesMpg = (() => {
        if (mpgMinValue === null && mpgMaxValue === null) return true;
        if (averageMpg === null) return false;
        if (mpgMinValue !== null && averageMpg < mpgMinValue) return false;
        if (mpgMaxValue !== null && averageMpg > mpgMaxValue) return false;
        return true;
      })();

      const defaultMin = priceLimits.min;
      const defaultMax = priceLimits.max || priceLimits.min;
      const minPrice = roundDownToThousand(priceRange.min ?? defaultMin);
      const maxPrice = roundUpToThousand(priceRange.max ?? defaultMax ?? minPrice);
      const matchesPrice = car.Price >= minPrice && car.Price <= maxPrice;

      return (
        matchesType &&
        matchesCondition &&
        matchesYear &&
        matchesSeatsRange &&
        matchesMileage &&
        matchesFuel &&
        matchesMpg &&
        matchesPrice
      );
    });
  }, [
    cars,
    selectedTypes,
    priceRange,
    priceLimits,
    conditionFilter,
    yearMin,
    yearMax,
    seatsMin,
    seatsMax,
    mileageMin,
    mileageMax,
    selectedFuelTypes,
    mpgMin,
    mpgMax,
  ]);

  const sortedCars = useMemo(() => {
    const list = [...filteredCars];
    switch (sortBy) {
      case 'price-asc':
        return list.sort((a, b) => a.Price - b.Price);
      case 'price-desc':
        return list.sort((a, b) => b.Price - a.Price);
      case 'mpg-asc':
        return list.sort((a, b) => compareMpg(a, b, 'asc'));
      case 'mpg-desc':
        return list.sort((a, b) => compareMpg(a, b, 'desc'));
      case 'az':
      default:
        return list.sort((a, b) => (a.Model || '').localeCompare(b.Model || ''));
    }
  }, [filteredCars, sortBy]);

  const effectiveMinPrice = roundDownToThousand(priceRange.min ?? priceLimits.min);
  const effectiveMaxPrice = roundUpToThousand(priceRange.max ?? priceLimits.max ?? effectiveMinPrice);
  const disablePriceControls = !cars.length || priceLimits.min === priceLimits.max;

  const toggleFilters = () => setFiltersOpen(prev => !prev);

  function toggleType(type: string) {
    setSelectedTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  }

  function toggleFuelType(type: FuelFilter) {
    setSelectedFuelTypes(prev => prev.includes(type) ? prev.filter(value => value !== type) : [...prev, type]);
  }

  function updateMinPrice(value: number) {
    setPriceRange(range => {
      const maxBound = range.max ?? priceLimits.max ?? value;
      const roundedMax = roundUpToThousand(maxBound);
      const bounded = clamp(value, priceLimits.min, roundedMax);
      const roundedMin = Math.min(roundDownToThousand(bounded), roundedMax);
      return { ...range, min: roundedMin };
    });
  }

  function updateMaxPrice(value: number) {
    setPriceRange(range => {
      const minBound = range.min ?? priceLimits.min ?? value;
      const roundedMin = roundDownToThousand(minBound);
      const bounded = clamp(value, roundedMin, priceLimits.max ?? value);
      const roundedMax = Math.max(roundUpToThousand(bounded), roundedMin);
      return { ...range, max: roundedMax };
    });
  }

  function handleClearLikes() {
    clearLikes();
    setCars([]);
    setPriceRange({ min: null, max: null });
    setSelectedTypes([]);
    setSortBy('az');
    setConditionFilter('Any');
    setYearMin('');
    setYearMax('');
    setSeatsMin('');
    setSeatsMax('');
    setMileageMin('');
    setMileageMax('');
    setSelectedFuelTypes([]);
    setMpgMin('');
    setMpgMax('');
    setSelectedCar(null);
    setModalVisible(false);
  }

  function openCarModal(car: Car) {
    setSelectedCar(car);
    setModalVisible(true);
  }

  function requestModalClose() {
    if (!selectedCar) return;
    setModalVisible(false);
  }

  useEffect(() => {
    if (isModalVisible || !selectedCar) return;
    const timeout = setTimeout(() => {
      setSelectedCar(null);
    }, MODAL_ANIMATION_MS);
    return () => clearTimeout(timeout);
  }, [isModalVisible, selectedCar]);


  return (
    <main>
      <NavBar />
      <motion.section
        className="mx-auto max-w-6xl px-4 pt-12 pb-24"
        initial={{ opacity: 0, y: 24, filter: 'blur(2px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.header className="text-center" variants={CHILD_FADE_VARIANTS}>
          <p className="text-sm uppercase tracking-[0.45em] text-red-500">Toyota Vehicles</p>
          <h1 className="mt-3 text-4xl font-bold text-slate-900">Find your saved Toyotas</h1>
          <p className="mt-2 text-slate-600">Dial in seating, budget, and body style filters to revisit the Toyotas you loved.</p>
        </motion.header>

          <motion.div
            className="mt-10 rounded-[36px] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_70px_rgba(15,23,42,0.12)] backdrop-blur supports-[backdrop-filter]:backdrop-blur-xl lg:p-10"
            variants={CHILD_FADE_VARIANTS}
          >
            <motion.div className="grid gap-10 lg:grid-cols-[280px,1fr]" variants={CHILD_FADE_VARIANTS}>
              <motion.aside className="border-r border-slate-100 pr-0 lg:pr-8" variants={CHILD_FADE_VARIANTS}>
                <div className="flex items-center justify-between pb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold text-slate-900">Filters</h2>
                    <button
                      type="button"
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-red-200 hover:text-red-500"
                      aria-label={filtersOpen ? 'Collapse filters' : 'Expand filters'}
                      aria-expanded={filtersOpen}
                      onClick={toggleFilters}
                    >
                      <motion.span animate={{ rotate: filtersOpen ? 180 : 0 }} transition={{ duration: 0.2, ease: 'easeInOut' }}>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </motion.span>
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary text-sm px-4 py-2"
                    onClick={handleClearLikes}
                  >
                    Clear liked cars
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {filtersOpen && (
                    <motion.div
                      key="filters-content"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-8 pt-4">
                        <div className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="label" htmlFor="liked-price-min">Price from</label>
                              <div className="relative">
                                <span className="input-prefix">$</span>
                                <input
                                  id="liked-price-min"
                                  type="number"
                                  min={0}
                                  step={1000}
                                  value={effectiveMinPrice}
                                  onChange={e => updateMinPrice(Number(e.target.value))}
                                  disabled={disablePriceControls}
                                  className="input input--with-prefix"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="label" htmlFor="liked-price-max">Price to</label>
                              <div className="relative">
                                <span className="input-prefix">$</span>
                                <input
                                  id="liked-price-max"
                                  type="number"
                                  min={0}
                                  step={1000}
                                  value={effectiveMaxPrice}
                                  onChange={e => updateMaxPrice(Number(e.target.value))}
                                  disabled={disablePriceControls}
                                  className="input input--with-prefix"
                                />
                              </div>
                            </div>
                          </div>
                          <div>
                            <p className="label mb-2">Condition</p>
                            <div role="group" aria-label="Condition filters" className="flex flex-wrap gap-2">
                              {CONDITION_OPTIONS.map(option => (
                                <label key={option} className="cursor-pointer">
                                  <input
                                    type="radio"
                                    name="liked-condition"
                                    value={option}
                                    className="sr-only peer"
                                    checked={conditionFilter === option}
                                    onChange={() => setConditionFilter(option)}
                                  />
                                  <span className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-red-200 peer-checked:border-red-300 peer-checked:bg-red-50 peer-checked:text-red-600">
                                    {option}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <p className="label mb-2">Body type</p>
                            {typeOptions.length === 0 && <p className="text-sm text-slate-500">No vehicle types tracked yet.</p>}
                            <div role="group" aria-label="Body type filters" className="flex flex-wrap gap-2">
                              {typeOptions.map(([type, count]) => {
                                const checked = selectedTypes.includes(type);
                                return (
                                  <label key={type} className="cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="sr-only peer"
                                      checked={checked}
                                      onChange={() => toggleType(type)}
                                    />
                                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-red-200 peer-checked:border-red-300 peer-checked:bg-red-50 peer-checked:text-red-600">
                                      <span>{type}</span>
                                      <span className="text-xs text-slate-400">({count})</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="label" htmlFor="liked-year-min">Year from</label>
                              <input
                                id="liked-year-min"
                                className="input"
                                type="number"
                                min={1995}
                                value={yearMin}
                                onChange={e => setYearMin(e.target.value)}
                                placeholder="2018"
                              />
                            </div>
                            <div>
                              <label className="label" htmlFor="liked-year-max">Year to</label>
                              <input
                                id="liked-year-max"
                                className="input"
                                type="number"
                                min={1995}
                                value={yearMax}
                                onChange={e => setYearMax(e.target.value)}
                                placeholder={CURRENT_YEAR.toString()}
                              />
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="label" htmlFor="liked-seats-min">Seats from</label>
                              <input
                                id="liked-seats-min"
                                className="input"
                                type="number"
                                min={2}
                                max={9}
                                value={seatsMin}
                                onChange={e => setSeatsMin(e.target.value)}
                                placeholder="5"
                              />
                            </div>
                            <div>
                              <label className="label" htmlFor="liked-seats-max">Seats to</label>
                              <input
                                id="liked-seats-max"
                                className="input"
                                type="number"
                                min={2}
                                max={9}
                                value={seatsMax}
                                onChange={e => setSeatsMax(e.target.value)}
                                placeholder="8"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="label" htmlFor="liked-mileage-min">Mileage from</label>
                              <input
                                id="liked-mileage-min"
                                className="input"
                                type="number"
                                min={0}
                                step={5000}
                                value={mileageMin}
                                onChange={e => setMileageMin(e.target.value)}
                                placeholder="15000"
                              />
                            </div>
                            <div>
                              <label className="label" htmlFor="liked-mileage-max">Mileage to</label>
                              <input
                                id="liked-mileage-max"
                                className="input"
                                type="number"
                                min={0}
                                step={5000}
                                value={mileageMax}
                                onChange={e => setMileageMax(e.target.value)}
                                placeholder="60000"
                              />
                            </div>
                          </div>
                          <div>
                            <p className="label mb-2">Fuel type</p>
                            <div role="group" aria-label="Fuel type filters" className="flex flex-wrap gap-2">
                              {FUEL_TYPE_OPTIONS.map(type => {
                                const checked = selectedFuelTypes.includes(type);
                                return (
                                  <label key={type} className="cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="sr-only peer"
                                      checked={checked}
                                      onChange={() => toggleFuelType(type)}
                                    />
                                    <span className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-red-200 peer-checked:border-red-300 peer-checked:bg-red-50 peer-checked:text-red-600">
                                      {type}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="label" htmlFor="liked-mpg-min">MPG from</label>
                              <input
                                id="liked-mpg-min"
                                className="input"
                                type="number"
                                min={0}
                                max={100}
                                value={mpgMin}
                                onChange={e => setMpgMin(e.target.value)}
                                placeholder="30"
                              />
                            </div>
                            <div>
                              <label className="label" htmlFor="liked-mpg-max">MPG to</label>
                              <input
                                id="liked-mpg-max"
                                className="input"
                                type="number"
                                min={0}
                                max={100}
                                value={mpgMax}
                                onChange={e => setMpgMax(e.target.value)}
                                placeholder="45"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.aside>

              <motion.div className="space-y-6" variants={CHILD_FADE_VARIANTS}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Matches</p>
                    <h2 className="text-3xl font-semibold text-slate-900">{sortedCars.length} {sortedCars.length === 1 ? 'Match' : 'Matches'}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor="sort" className="text-sm font-semibold text-slate-600">Vehicle</label>
                    <select
                      id="sort"
                      className="select w-48"
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value as SortKey)}
                    >
                      <option value="az">Vehicle: A-Z</option>
                      <option value="price-asc">Price: Low → High</option>
                      <option value="price-desc">Price: High → Low</option>
                      <option value="mpg-asc">MPG: Low → High</option>
                      <option value="mpg-desc">MPG: High → Low</option>
                    </select>
                  </div>
                </div>

                {sortedCars.length === 0 ? (
                  <div className="mt-10 rounded-3xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
                    {!cars.length ? 'You have not liked any cars yet. Head to the swipe deck to get started.' : 'No liked cars match these filters. Adjust your filters to see more results.'}
                  </div>
                ) : (
                  <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                    {sortedCars.map(car => (
                      <VehicleCard
                        key={car.Id}
                        car={car}
                        onSelect={() => openCarModal(car)}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            </motion.div>
          </motion.div>
        </motion.section>
      {selectedCar && (
          <CarDetailModal
            car={selectedCar}
            closing={!isModalVisible}
            onRequestClose={requestModalClose}
          />
        )}
      </main>
  );
}

function countByCategory(cars: Car[]): [string, number][] {
  const map = new Map<string, number>();
  cars.forEach(car => {
    const category = getCategory(car);
    map.set(category, (map.get(category) ?? 0) + 1);
  });
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parseNumberInput(value: string): number | null {
  if (typeof value !== 'string') return null;
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getFuelCategory(car: Car): FuelFilter {
  const raw = (car['Fuel Type'] || car.FuelType || '').toLowerCase();
  if (raw.includes('hybrid')) return 'Hybrid';
  if (raw.includes('electric')) return 'Electric';
  return 'Gas';
}

function VehicleCard({ car, onSelect }: { car: Car; onSelect: () => void }) {
  const currency = formatCurrency(car.Price);
  const monthlyPayment = typeof car.MonthlyPayment === 'number' ? formatCurrency(car.MonthlyPayment) : null;
  const mpg = car.MPG || '—';
  const seating = typeof car.Seating === 'number' ? `${car.Seating} seats` : 'Seating TBD';
  const fuel = car['Fuel Type'] || car.FuelType || 'Fuel';
  const category = getCategory(car);
  const badge = car.Used ? 'Certified Used' : fuel;
  const imgSrc = car.ImageUrl || '/car-placeholder.svg';
  const dealerName = car.Dealer || 'Dealer pending';
  const dealerCity = car.DealerCity && car.DealerState ? `${car.DealerCity}, ${car.DealerState}` : car.DealerCity || null;
  const distanceText = car.DistanceLabel || (typeof car.DistanceMiles === 'number' ? `${car.DistanceMiles.toFixed(1)} mi away` : null);
  const dealerDetails = [dealerCity, distanceText].filter(Boolean).join(' • ');
  const dealerWebsite = car.DealerWebsite;
  const modelUrl = car.ModelUrl;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className="group h-full rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition hover:-translate-y-1 hover:shadow-[0_24px_50px_rgba(244,63,94,0.18)] focus:outline-none focus:ring-2 focus:ring-red-300"
    >
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
        <span>{category}</span>
        <span>{badge}</span>
      </div>
      <div className="mt-4 flex h-40 items-center justify-center rounded-2xl bg-slate-50">
        <Image src={imgSrc} alt={`${car.Year} ${car.Model}`} width={320} height={180} className="h-full w-full object-contain" />
      </div>
      <div className="mt-4 text-sm text-slate-500">{car.Year}</div>
      <h3 className="text-2xl font-semibold text-slate-900">{car.Model}</h3>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-3xl font-bold text-slate-900">{currency}</p>
          <p className="text-xs text-slate-500">{car.Used ? 'Pre-owned asking price' : 'Starting MSRP *'}</p>
          {monthlyPayment && (
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <span>Est. {monthlyPayment}/mo</span>
                <AprInfoIcon />
              </p>
              <AprDealsLink />
            </div>
          )}
        </div>
        <div className="text-right text-sm text-slate-500">
          <p className="font-semibold text-slate-900">{mpg}</p>
          <p>Up to est. MPG*</p>
          <p className="mt-1">{seating}</p>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-sm text-slate-600">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Dealer</p>
        <p className="font-semibold text-slate-900">{dealerName}</p>
        <p>{dealerDetails || 'Distance visible after sharing a zip code.'}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {dealerWebsite && (
          <a
            href={dealerWebsite}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary px-4 py-2 text-sm"
            onClick={event => event.stopPropagation()}
          >
            Reach out to dealer
          </a>
        )}
        {modelUrl && (
          <a
            href={modelUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline px-4 py-2 text-sm"
            onClick={event => event.stopPropagation()}
          >
            Explore
          </a>
        )}
      </div>
    </article>
  );
}

function getAverageMpg(car: Car): number | null {
  if (!car.MPG) return null;
  const cleaned = car.MPG.replace(/[^0-9.–-]/g, '');
  if (!cleaned) return null;
  const parts = cleaned.split(/[-–]/).map(part => parseFloat(part)).filter(val => !Number.isNaN(val));
  if (!parts.length) return null;
  const sum = parts.reduce((acc, val) => acc + val, 0);
  return sum / parts.length;
}

function compareMpg(a: Car, b: Car, direction: 'asc' | 'desc') {
  const mpgA = getAverageMpg(a);
  const mpgB = getAverageMpg(b);
  if (mpgA === null && mpgB === null) return 0;
  if (mpgA === null) return 1;
  if (mpgB === null) return -1;
  return direction === 'asc' ? mpgA - mpgB : mpgB - mpgA;
}

function roundDownToThousand(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value / 1000) * 1000;
}

function roundUpToThousand(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.ceil(value / 1000) * 1000;
}
