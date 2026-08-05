import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors/AppError.js";
import { handlePrismaError } from "../../common/utils/prismaErrors.js";
import type {
  CreateInstituteClassInput,
  CreateInstituteDivisionInput,
  CreateInstituteInput,
  UpdateInstituteInput,
} from "./institutes.schema.js";

export async function createInstitute(input: CreateInstituteInput) {
  try {
    return await prisma.institute.create({ data: input });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function listInstitutes() {
  return prisma.institute.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getInstituteById(id: string) {
  const institute = await prisma.institute.findUnique({
    where: { id },
    include: { classes: { include: { divisions: true } } },
  });
  if (!institute) {
    throw new NotFoundError("Institute not found");
  }
  return institute;
}

export async function updateInstitute(id: string, input: UpdateInstituteInput) {
  await getInstituteById(id);
  try {
    return await prisma.institute.update({ where: { id }, data: input });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function deleteInstitute(id: string) {
  await getInstituteById(id);
  await prisma.institute.delete({ where: { id } });
}

export async function createInstituteClass(
  instituteId: string,
  input: CreateInstituteClassInput
) {
  await getInstituteById(instituteId);
  try {
    return await prisma.instituteClass.create({
      data: { ...input, instituteId },
    });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function listInstituteClasses(instituteId: string) {
  await getInstituteById(instituteId);
  return prisma.instituteClass.findMany({
    where: { instituteId },
    include: { divisions: true },
    orderBy: { createdAt: "asc" },
  });
}

async function getInstituteClassOrThrow(instituteId: string, classId: string) {
  const instituteClass = await prisma.instituteClass.findFirst({
    where: { id: classId, instituteId },
  });
  if (!instituteClass) {
    throw new NotFoundError("Class not found for this institute");
  }
  return instituteClass;
}

export async function createInstituteDivision(
  instituteId: string,
  classId: string,
  input: CreateInstituteDivisionInput
) {
  await getInstituteClassOrThrow(instituteId, classId);
  try {
    return await prisma.instituteDivision.create({
      data: { ...input, classId },
    });
  } catch (err) {
    handlePrismaError(err);
  }
}

export async function listInstituteDivisions(instituteId: string, classId: string) {
  await getInstituteClassOrThrow(instituteId, classId);
  return prisma.instituteDivision.findMany({
    where: { classId },
    orderBy: { createdAt: "asc" },
  });
}
