import type { Request, Response } from "express";
import * as sessionsService from "./sessions.service.js";
import type {
  AddSlotsBody,
  BookSessionsBody,
  BookingOptionsQuery,
  CancelSessionBody,
  CounsellorMyStudentsQuery,
  CounsellorSessionsQuery,
  CreateSessionBody,
  ImportSlotsBody,
  JoinSessionBody,
  ListSessionsQuery,
  ListSlotsQuery,
  MarkNoShowBody,
  RescheduleSessionBody,
  SendDayReminderBody,
  SetNotesBody,
} from "./sessions.schema.js";

export async function importSlots(req: Request, res: Response): Promise<void> {
  const result = await sessionsService.importSlots(req.body as ImportSlotsBody);
  res.status(201).json(result);
}

export async function addSlots(req: Request, res: Response): Promise<void> {
  const result = await sessionsService.addSlots(req.body as AddSlotsBody);
  res.status(201).json(result);
}

export async function deleteSlot(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  await sessionsService.deleteSlot(id);
  res.status(204).send();
}

export async function listSlots(req: Request, res: Response): Promise<void> {
  const slots = await sessionsService.listSlots(req.query as unknown as ListSlotsQuery);
  res.status(200).json(slots);
}

export async function getBookingOptions(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as { studentId: string };
  const query = req.query as unknown as BookingOptionsQuery;

  if (query.sessionNumber === "SESSION_2") {
    if (!query.session1Date || !query.session1StartTime) {
      res.status(400).json({ error: { message: "session1Date and session1StartTime are required to preview Session 2 options" } });
      return;
    }
    const options = await sessionsService.getSession2BookingOptions(studentId, query.session1Date, query.session1StartTime);
    res.status(200).json(options);
    return;
  }

  const options = await sessionsService.getSession1BookingOptions(studentId, query.rescheduleSessionId);
  res.status(200).json(options);
}

export async function bookSessions(req: Request, res: Response): Promise<void> {
  const { studentId } = req.params as { studentId: string };
  const result = await sessionsService.bookSessions(studentId, req.body as BookSessionsBody);
  res.status(201).json(result);
}

export async function createSession(req: Request, res: Response): Promise<void> {
  const session = await sessionsService.createSessionManually(req.body as CreateSessionBody);
  res.status(201).json(session);
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const sessions = await sessionsService.listSessions(req.query as unknown as ListSessionsQuery);
  res.status(200).json(sessions);
}

export async function getSession(req: Request, res: Response): Promise<void> {
  const session = await sessionsService.getSessionById(req.params.id as string);
  res.status(200).json(session);
}

export async function getStudentSessions(req: Request, res: Response): Promise<void> {
  const sessions = await sessionsService.getStudentSessions(req.params.studentId as string);
  res.status(200).json(sessions);
}

export async function getCounsellorSessions(req: Request, res: Response): Promise<void> {
  const { status } = req.query as unknown as CounsellorSessionsQuery;
  const sessions = await sessionsService.getCounsellorSessions(req.params.counsellorId as string, status);
  res.status(200).json(sessions);
}

export async function getCounsellorMyStudents(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as CounsellorMyStudentsQuery;
  const students = await sessionsService.getCounsellorMyStudents(req.params.counsellorId as string, query);
  res.status(200).json(students);
}

export async function joinSession(req: Request, res: Response): Promise<void> {
  const { role } = req.body as JoinSessionBody;
  const result = await sessionsService.joinSession(req.params.id as string, role);
  res.status(200).json(result);
}

export async function completeSession(req: Request, res: Response): Promise<void> {
  const session = await sessionsService.completeSession(req.params.id as string);
  res.status(200).json(session);
}

export async function setNotes(req: Request, res: Response): Promise<void> {
  const { notes } = req.body as SetNotesBody;
  const session = await sessionsService.setNotes(req.params.id as string, notes);
  res.status(200).json(session);
}

export async function rescheduleSession(req: Request, res: Response): Promise<void> {
  const session = await sessionsService.rescheduleSession(req.params.id as string, req.body as RescheduleSessionBody);
  res.status(200).json(session);
}

export async function cancelSession(req: Request, res: Response): Promise<void> {
  const session = await sessionsService.cancelSession(req.params.id as string, req.body as CancelSessionBody);
  res.status(200).json(session);
}

export async function restartStudentSessions(req: Request, res: Response): Promise<void> {
  const result = await sessionsService.restartStudentSessions(req.params.studentId as string);
  res.status(200).json(result);
}

export async function markNoShow(req: Request, res: Response): Promise<void> {
  const { party } = req.body as MarkNoShowBody;
  const session = await sessionsService.markSessionNoShow(req.params.id as string, party);
  res.status(200).json(session);
}

export async function sendNoShowReschedulePrompt(req: Request, res: Response): Promise<void> {
  const result = await sessionsService.sendNoShowReschedulePrompt(req.params.id as string);
  res.status(202).json(result);
}

export async function sendDayReminder(req: Request, res: Response): Promise<void> {
  const result = await sessionsService.sendDayReminder(req.params.id as string, req.body as SendDayReminderBody);
  res.status(202).json(result);
}
