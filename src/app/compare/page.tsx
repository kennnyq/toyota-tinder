'use client';

import { type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import NavBar from '@/components/NavBar';
import { formatCurrency, getCategory } from '@/lib/carDisplay';
import { getLikedCars } from '@/lib/likes';
import { Car } from '@/lib/types';

type ComparisonField = {
  label: string;
  render: (car: Car | null) => ReactNode;
};

const COMPARISON_FIELDS: ComparisonField[] = [
  { label: 'Price', render: car => (car ? formatCurrency(car.Price) : '—') },
  { label: 'Year', render: car => car?.Year ?? '—' },
  { label: 'Condition', render: car => car?.Condition ?? '—' },
  { label: 'Category', render: car => (car ? getCategory(car) : '—') },
  { label: 'Fuel', render: car => getFuelType(car) },
  { label: 'MPG', render: car => car?.MPG ?? '—' },
  { label: 'Engine', render: car => car?.Engine ?? '—' },
  { label: 'Transmission', render: car => car?.Transmission ?? '—' },
  { label: 'Drivetrain', render: car => car?.Drivetrain ?? '—' },
  { label: 'Seating', render: car => formatSeating(car) },
  { label: 'Mileage', render: car => formatMileage(car) },
  { label: 'Exterior', render: car => car?.ExteriorColor ?? '—' },
  { label: 'Interior', render: car => car?.InteriorColor ?? '—' },
  { label: 'Dealer', render: car => car?.Dealer ?? '—' },
  { label: 'Dealer Location', render: car => formatDealerLocation(car) },
  { label: 'Distance', render: car => formatDistance(car) },
  { label: 'Fit Notes', render: car => car?.FitDescription ?? '—' },
];

const LIKES_STORAGE_KEY = 'toyotaTinder.likes';
const LIKE_DETAILS_KEY = 'toyotaTinder.likeDetails';

export default function ComparePage() {
  const [cars, setCars] = useState<Car[]>([]);
  const [primaryId, setPrimaryId] = useState<number | null>(null);
  const [secondaryId, setSecondaryId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const leftSeed = parseId(params.get('left'));
    const rightSeed = parseId(params.get('right'));

    const bootstrap = () => {
      if (cancelled) return;
      const liked = getLikedCars();
      setCars(liked);
      const seededPrimary = selectValidId(leftSeed, liked);
      const seededSecondary = selectValidId(rightSeed, liked, seededPrimary ?? undefined);
      const fallbackPrimary = seededPrimary ?? liked[0]?.Id ?? null;
      const fallbackSecondary =
        seededSecondary ??
        liked.find(car => car.Id !== fallbackPrimary)?.Id ??
        (liked.length > 1 ? liked[1].Id : null);
      setPrimaryId(fallbackPrimary);
      setSecondaryId(fallbackSecondary);
    };

    bootstrap();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LIKES_STORAGE_KEY || event.key === LIKE_DETAILS_KEY) {
        if (cancelled) return;
        setCars(getLikedCars());
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      cancelled = true;
      window.removeEventListener('storage', handleStorage);
    };
  }, []);
  const primarySelectionId = useMemo(() => ensureValidPrimary(primaryId, cars), [primaryId, cars]);
  const secondarySelectionId = useMemo(
    () => ensureValidSecondary(secondaryId, cars, primarySelectionId),
    [secondaryId, cars, primarySelectionId],
  );
  const primaryCar = useMemo(() => cars.find(car => car.Id === primarySelectionId) ?? null, [cars, primarySelectionId]);
  const secondaryCar = useMemo(
    () => cars.find(car => car.Id === secondarySelectionId) ?? null,
    [cars, secondarySelectionId],
  );
  function handlePrimaryChange(event: ChangeEvent<HTMLSelectElement>) {
    const id = Number(event.target.value);
    if (Number.isNaN(id)) return;
    setPrimaryId(id);
    if (secondarySelectionId === id) {
      setSecondaryId(findAlternativeId(id));
    }
  }

  function handleSecondaryChange(event: ChangeEvent<HTMLSelectElement>) {
    const id = Number(event.target.value);
    if (Number.isNaN(id)) return;
    setSecondaryId(id);
    if (primarySelectionId === id) {
      setPrimaryId(findAlternativeId(id));
    }
  }

  function swapSelections() {
    if (!primarySelectionId || !secondarySelectionId) return;
    setPrimaryId(secondarySelectionId);
    setSecondaryId(primarySelectionId);
  }

  function findAlternativeId(excludeId: number | null): number | null {
    const alternative = cars.find(car => car.Id !== excludeId);
    return alternative ? alternative.Id : null;
  }

  return (
    <main>
      <NavBar />
      <section className="mx-auto max-w-6xl px-4 pt-12 pb-24">
        <header className="page-fade-in text-center" style={{ animationDelay: '0s' }}>
          <p className="text-sm uppercase tracking-[0.45em] text-red-500">Toyota Vehicles</p>
          <h1 className="mt-3 text-4xl font-bold text-slate-900">Compare your top Toyotas</h1>
          <p className="mt-2 text-slate-600">
            Choose any two vehicles from your liked garage to see a stat-by-stat breakdown before making the call.
          </p>
        </header>

        {cars.length < 2 ? (
          <EmptyState />
        ) : (
          <div className="mt-10 space-y-8">
            <div className="page-fade-in rounded-[32px] border border-slate-200 bg-white/80 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.08)] lg:p-8" style={{ animationDelay: '0.12s' }}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <SelectControl
                  id="primary-car"
                  label="Select vehicle"
                  value={primarySelectionId ?? undefined}
                  cars={cars}
                  onChange={handlePrimaryChange}
                />
                <button
                  type="button"
                  aria-label="Swap selected vehicles"
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-500 transition hover:cursor-pointer hover:text-red-500 lg:mx-0 lg:self-center lg:translate-y-3"
                  onClick={swapSelections}
                >
                  <SwapIcon />
                </button>
                <SelectControl
                  id="secondary-car"
                  label="Select vehicle"
                  value={secondarySelectionId ?? undefined}
                  cars={cars}
                  onChange={handleSecondaryChange}
                  offsetId={primarySelectionId}
                />
              </div>
            </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <CarSummaryCard car={primaryCar} delay={0.18} />
                <CarSummaryCard car={secondaryCar} delay={0.22} />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <VehicleStatsTable car={primaryCar} delay={0.26} />
                <VehicleStatsTable car={secondaryCar} delay={0.3} />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function SelectControl({
  id,
  label,
  value,
  cars,
  onChange,
  offsetId,
}: {
  id: string;
  label: string;
  value?: number | null;
  cars: Car[];
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  offsetId?: number | null;
}) {
  const selectableCars = offsetId != null ? cars.filter(car => car.Id !== offsetId) : cars;
  const normalizedValue = value != null ? String(value) : '';
  return (
    <label htmlFor={id} className="flex flex-1 flex-col gap-2 text-sm font-semibold text-slate-600">
      {label}
      <select
        id={id}
        className="rounded-2xl border border-slate-200 px-4 py-3 text-base font-semibold text-slate-800 shadow-[0_10px_30px_rgba(15,23,42,0.08)] focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
        value={normalizedValue}
        onChange={onChange}
      >
        <option value="" disabled>
          Select a vehicle
        </option>
        {selectableCars.map(car => (
          <option key={car.Id} value={String(car.Id)}>
            {car.Year} {car.Model}
          </option>
        ))}
      </select>
    </label>
  );
}

function CarSummaryCard({ car, delay = 0 }: { car: Car | null; delay?: number }) {
  const price = car ? formatCurrency(car.Price) : null;
  const imgSrc = car?.ImageUrl || '/car-placeholder.svg';
  const seating = formatSeating(car);
  const mpg = car?.MPG ?? '—';

  return (
    <div
      className="page-fade-in rounded-[32px] border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 p-6 shadow-[0_20px_55px_rgba(15,23,42,0.08)]"
      style={{ animationDelay: `${delay}s` }}
    >
      {car ? (
        <>
          <div className="mt-2 flex h-48 items-center justify-center rounded-[28px] bg-white">
            <Image src={imgSrc} alt={`${car.Year} ${car.Model}`} width={360} height={200} className="h-full w-full object-contain" />
          </div>
          <h2 className="mt-4 text-2xl font-semibold text-slate-900">{car.Year} {car.Model}</h2>
          <p className="text-sm text-slate-500">{car.Used ? 'Pre-owned listing' : 'Factory-new configuration'}</p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
            <SummaryStat label="Price" value={price ?? '—'} />
            <SummaryStat label="MPG" value={mpg} />
            <SummaryStat label="Seating" value={seating} />
          </div>
        </>
      ) : (
        <div className="mt-4 rounded-[28px] border border-dashed border-slate-200 bg-white/50 p-6 text-center text-slate-500">
          Select a vehicle to see its quick stats.
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white/80 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function VehicleStatsTable({ car, delay = 0 }: { car: Car | null; delay?: number }) {
  const heading = car ? `${car.Year} ${car.Model}` : 'Select a vehicle';
  const subheading = car ? (car.Used ? 'Pre-owned listing' : 'Factory-new configuration') : 'Pick a vehicle to view stats.';
  const valueClass = car ? 'text-slate-900' : 'text-slate-300';
  return (
    <div
      className="page-fade-in rounded-[32px] border border-slate-200 bg-white/90 shadow-[0_25px_70px_rgba(15,23,42,0.12)]"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="border-b border-slate-100 px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">Vehicle stats</p>
        <h3 className="mt-2 text-2xl font-semibold text-slate-900">{heading}</h3>
        <p className="mt-1 text-sm text-slate-500">{subheading}</p>
      </div>
      <div>
        {COMPARISON_FIELDS.map(field => {
          const isFitNotes = field.label === 'Fit Notes';
          const rowClass = `flex justify-between border-t border-slate-100 px-6 py-4 first:border-t-0 ${isFitNotes ? 'items-start' : 'items-center'}`;
          return (
          <div key={field.label} className={rowClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">{field.label}</p>
            <p
              className={`text-base font-semibold ${isFitNotes ? 'text-left pl-4' : 'text-right'} ${valueClass}`}
            >
              {field.render(car)}
            </p>
          </div>
        );
      })}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="page-fade-in mt-10 rounded-[36px] border border-dashed border-slate-300 bg-white/80 p-10 text-center shadow-[0_20px_50px_rgba(15,23,42,0.08)]"
      style={{ animationDelay: '0.12s' }}
    >
      <p className="text-sm font-semibold uppercase tracking-[0.45em] text-slate-400">Need more data</p>
      <h2 className="mt-3 text-3xl font-semibold text-slate-900">Save at least two Toyotas to compare</h2>
      <p className="mt-2 text-slate-600">
        Use the compare form to dial in your preferences, then swipe through the deck to like more Toyotas before
        returning here.
      </p>
      <Link href="/find" className="btn btn-primary mt-6 inline-flex items-center justify-center">
        Open the swipe deck
      </Link>
    </div>
  );
}

function parseId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function selectValidId(id: number | null, cars: Car[], excludeId?: number) {
  if (id === null) return null;
  const match = cars.find(car => car.Id === id && car.Id !== excludeId);
  return match ? match.Id : null;
}

function ensureValidPrimary(id: number | null, cars: Car[]) {
  if (!cars.length) return null;
  if (id !== null && cars.some(car => car.Id === id)) return id;
  return cars[0].Id;
}

function ensureValidSecondary(id: number | null, cars: Car[], primaryId: number | null) {
  if (cars.length < 2) return null;
  const activePrimary = primaryId ?? cars[0]?.Id ?? null;
  const pool = activePrimary !== null ? cars.filter(car => car.Id !== activePrimary) : cars;
  if (!pool.length) return null;
  if (id !== null && pool.some(car => car.Id === id)) return id;
  return pool[0].Id;
}

function getFuelType(car: Car | null) {
  if (!car) return '—';
  return car['Fuel Type'] || car.FuelType || '—';
}

function formatSeating(car: Car | null) {
  if (!car || typeof car.Seating !== 'number') return '—';
  return `${car.Seating} seats`;
}

function formatMileage(car: Car | null) {
  if (!car || typeof car.Mileage !== 'number') return '—';
  return `${car.Mileage.toLocaleString()} mi`;
}

function formatDealerLocation(car: Car | null) {
  if (!car) return '—';
  if (car.DealerCity && car.DealerState) return `${car.DealerCity}, ${car.DealerState}`;
  return car.DealerCity || car.DealerState || '—';
}

function formatDistance(car: Car | null) {
  if (!car) return '—';
  if (car.DistanceLabel) return car.DistanceLabel;
  if (typeof car.DistanceMiles === 'number') return `${car.DistanceMiles.toFixed(1)} mi away`;
  return '—';
}

function SwapIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 7h12" />
      <path d="M13 3l4 4-4 4" />
      <path d="M17 17H5" />
      <path d="M11 13l-4 4 4 4" />
    </svg>
  );
}
