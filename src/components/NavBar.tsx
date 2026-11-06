'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function NavBar() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAuth = () => {
      try {
        setIsAuthenticated(Boolean(window.localStorage.getItem('tt-auth')));
      } catch {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
    window.addEventListener('storage', checkAuth);
    return () => window.removeEventListener('storage', checkAuth);
  }, []);

  function handleSignOut() {
    try {
      window.localStorage.removeItem('tt-auth');
    } catch {
      // ignore storage errors on sign out
    }
    setIsAuthenticated(false);
    router.push('/');
  }

  const authButtonClass = 'nav-pill nav-pill-auth border-red-200/80 text-red-600 hover:border-red-300';
  const authLinkClass = 'nav-pill nav-pill-auth';
  const githubLinkClass = 'nav-pill nav-pill-compact';

  return (
    <header className="sticky top-0 z-50 w-full border-b border-red-100/70 bg-white/70 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-2 text-slate-900">
        <Link
          href="/"
          className="flex items-center gap-2 text-slate-900 transition hover:text-red-600"
        >
          <Image
            src="/toyotatinder.png"
            alt="ToyotaTinder"
            width={40}
            height={40}
            className="h-10 w-10 object-contain"
            priority
          />
          <span className="brand-wordmark text-lg font-semibold text-slate-900">Toyota Tinder</span>
        </Link>

        <div className="ml-auto flex items-center gap-1 rounded-full border border-slate-200/70 bg-white/80 px-2 py-0.5 text-sm font-semibold shadow-[0_12px_35px_rgba(15,23,42,0.08)]">
          <Link className="nav-pill" href="/find">Find</Link>
          <Link className="nav-pill" href="/liked">Liked</Link>
          <Link className="nav-pill" href="/compare">Compare</Link>
          <a className="nav-pill" href="https://www.toyota.com/" target="_blank" rel="noreferrer">Toyota</a>
          <a
            className={githubLinkClass}
            href="https://github.com/kennnyq/Hackathon2025"
            target="_blank"
            rel="noreferrer"
            aria-label="Project GitHub"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
              <path
                fill="currentColor"
                d="M12 2c5.53 0 10 4.48 10 10.02 0 4.43-2.87 8.19-6.84 9.51-.5.09-.68-.22-.68-.48 0-.33.01-1.19.01-2.32 0-.79-.27-1.3-.58-1.56 2.23-.25 4.57-1.11 4.57-5 0-1.11-.39-2.01-1.03-2.72.1-.26.45-1.31-.1-2.73 0 0-.84-.27-2.75 1.04a9.35 9.35 0 0 0-5 0C8.69 6.18 7.85 6.45 7.85 6.45c-.55 1.42-.2 2.47-.1 2.73A3.71 3.71 0 0 0 6.72 12c0 3.87 2.33 4.75 4.55 5-.29.25-.55.7-.64 1.36-.58.26-2.05.7-2.95-.84 0 0-.54-.99-1.58-1.07 0 0-1.01-.01-.07.63 0 0 .68.32 1.15 1.52 0 0 .6 1.86 3.44 1.23 0 .88.01 1.71.01 1.97 0 .26-.18.57-.68.48A10.02 10.02 0 0 1 2 12.02C2 6.48 6.48 2 12 2Z"
              />
            </svg>
          </a>
          {isAuthenticated ? (
            <button
              type="button"
              onClick={handleSignOut}
              className={authButtonClass}
            >
              Sign out
            </button>
          ) : (
            <Link className={authLinkClass} href="/login">
              Log in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
