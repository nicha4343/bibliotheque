import type { Loan } from '../db/schema';
import { formatDate, formatNearDate, fr } from '../textes/fr';

// Dates of a loan. Without the database: the service worker uses them too (notifications, lot 4).

export type LoanDuration = '2w' | '1m' | '2m';

export const LOAN_DURATIONS: readonly LoanDuration[] = ['2w', '1m', '2m'];
export const DEFAULT_LOAN_DURATION: LoanDuration = '1m';

/**
 * Day the book is expected back, at noon local time (safe from daylight-saving changes). A month
 * later is the same day of the month, or the last day of a shorter month (31 January → 28 February).
 */
export function dueDate(lentAt: Date, duration: LoanDuration): Date {
  const due = new Date(lentAt.getFullYear(), lentAt.getMonth(), lentAt.getDate(), 12);
  if (duration === '2w') {
    due.setDate(due.getDate() + 14);
    return due;
  }
  const day = due.getDate();
  due.setDate(1);
  due.setMonth(due.getMonth() + (duration === '1m' ? 1 : 2));
  const lastDay = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate();
  due.setDate(Math.min(day, lastDay));
  return due;
}

const dayNumber = (date: Date): number => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;

/** « due » on the day the book is expected back, « late » from the next day. */
export type LoanState = 'running' | 'due' | 'late';

export function loanState(loan: Pick<Loan, 'dueAt'>, now: Date): LoanState {
  const days = dayNumber(now) - dayNumber(new Date(loan.dueAt));
  return days < 0 ? 'running' : days === 0 ? 'due' : 'late';
}

/** « Rappel le 1er décembre », « Retour prévu aujourd’hui », « En retard · retour prévu le 1er octobre ». */
export function loanStateText(loan: Pick<Loan, 'dueAt'>, now: Date): string {
  const due = formatNearDate(new Date(loan.dueAt), now);
  switch (loanState(loan, now)) {
    case 'running':
      return fr.loans.reminderOn(due);
    case 'due':
      return fr.loans.dueToday;
    case 'late':
      return fr.loans.late(due);
  }
}

export const isActive = (loan: Loan): boolean => loan.returnedAt === undefined;

/** Loans in progress whose return day has come. */
export const dueLoans = (loans: readonly Loan[], now: Date): Loan[] =>
  loans.filter((loan) => isActive(loan) && loanState(loan, now) !== 'running');

/** Due loans not yet notified on the phone (« Notification à l’échéance »). */
export const loansToNotify = (loans: readonly Loan[], now: Date): Loan[] =>
  dueLoans(loans, now).filter((loan) => loan.notifiedAt === undefined);

/** Due loans not yet seen in the app: the reminder of the library screen. */
export const unseenDueLoans = (loans: readonly Loan[], now: Date): Loan[] =>
  dueLoans(loans, now).filter((loan) => loan.seenAt === undefined);

const yyyymmdd = (date: Date): string =>
  `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;

/**
 * « Ajouter chaque prêt à l’agenda »: Google Agenda page creating an all-day event on the return day,
 * which the calendar of the phone reminds the user of.
 */
export function calendarUrl(loan: Pick<Loan, 'borrower' | 'lentAt' | 'dueAt'>, title: string): string {
  const day = new Date(loan.dueAt);
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: fr.loanReminders.calendarTitle(title, loan.borrower),
    dates: `${yyyymmdd(day)}/${yyyymmdd(next)}`,
    details: fr.loanReminders.calendarDetails(formatDate(new Date(loan.lentAt))),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Phone notification for the loans whose return day has come: the first one named, the others counted. */
export function reminderNotification(items: readonly { title: string; borrower: string }[]): { title: string; body: string } {
  const [first] = items;
  const others = items.length - 1;
  return {
    title: fr.loanReminders.notificationTitle(items.length),
    body: !first
      ? ''
      : others > 0
        ? fr.loanReminders.notificationMore(first.title, first.borrower, others)
        : fr.loanReminders.notificationItem(first.title, first.borrower),
  };
}

/** Periodic check of the service worker (« Notification à l’échéance »). */
export const LOAN_REMINDERS_TAG = 'loan-reminders';
/** Asks the service worker to check the loans at once (when the notifications are switched on). */
export const NOTIFY_LOANS_MESSAGE = 'NOTIFY_LOANS';
