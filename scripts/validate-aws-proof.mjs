#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import {
  CONTRACT,
  ProofValidationError,
  buildShareableReport,
  canonicalJson,
  computeChainDigest,
  createAttemptRecord,
  deriveDeploymentId,
  identitySha256,
  normalizeCloudTrailEvent,
  selectCloudTrailEvent,
  sha256,
  validateAwsProof,
  validateCanonicalTemplateBytes,
  validateCliSkeleton,
  validateShareableReport
} from './aws-proof.mjs';

function fail(code, message) {
  throw new ProofValidationError(code, message);
}

function requireCondition(condition, code, message) {
  if (!condition) fail(code, message);
}

function requireObject(value, code, label) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), code, `${label} debe ser un objeto.`);
  return value;
}

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    requireCondition(name?.startsWith('--') && value !== undefined, 'ARGUMENTS', 'Los argumentos deben ser pares --nombre valor.');
    requireCondition(!parsed.has(name), 'ARGUMENTS', `Argumento repetido: ${name}.`);
    parsed.set(name, value);
  }
  return parsed;
}

function required(args, name) {
  const value = args.get(name);
  requireCondition(typeof value === 'string' && value.length > 0, 'ARGUMENTS', `Falta ${name}.`);
  return value;
}

function readJson(path, code = 'JSON') {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(code, `No se pudo leer JSON válido en ${basename(path)}.`);
  }
}

function fileMode(path) {
  return statSync(path).mode & 0o777;
}

function requirePrivateDirectory(path) {
  const info = lstatSync(path);
  requireCondition(info.isDirectory() && !info.isSymbolicLink(), 'PRIVATE_MODE', 'El directorio de evidencia no es regular.');
  requireCondition(fileMode(path) === 0o700, 'PRIVATE_MODE', 'El directorio de evidencia debe tener modo 0700.');
}

function requirePrivateFile(path) {
  const info = lstatSync(path);
  requireCondition(info.isFile() && !info.isSymbolicLink(), 'PRIVATE_MODE', `${basename(path)} no es un archivo regular.`);
  requireCondition(fileMode(path) === 0o600, 'PRIVATE_MODE', `${basename(path)} debe tener modo 0600.`);
}

function writeExclusive(path, value) {
  requireCondition(!existsSync(path), 'WRITE_ONCE', `${basename(path)} ya existe y no se sobrescribirá.`);
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, value);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
  requirePrivateFile(path);
}

function writeExclusiveJson(path, value) {
  writeExclusive(path, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeIdentity(raw, attempt) {
  const accountId = raw.Account ?? raw.accountId;
  const principalArn = raw.Arn ?? raw.principalArn;
  const userId = raw.UserId ?? raw.userId;
  requireCondition(typeof accountId === 'string' && typeof principalArn === 'string' && typeof userId === 'string', 'IDENTITY', 'La respuesta STS está incompleta.');
  return { accountId, principalArn, userId, profile: attempt.profile, region: attempt.region };
}

function readCapture(attemptDirectory, prefix) {
  const metadataPath = join(attemptDirectory, `${prefix}.capture.json`);
  const stdoutPath = join(attemptDirectory, `${prefix}.stdout`);
  const stderrPath = join(attemptDirectory, `${prefix}.stderr`);
  for (const path of [metadataPath, stdoutPath, stderrPath]) requirePrivateFile(path);
  const metadata = readJson(metadataPath, 'CAPTURE');
  const stdout = readFileSync(stdoutPath);
  const stderr = readFileSync(stderrPath);
  requireCondition(metadata.stdoutSha256 === sha256(stdout) && metadata.stderrSha256 === sha256(stderr), 'CAPTURE_HASH', `Los hashes de ${prefix} no coinciden.`);
  return { ...metadata, stdout, stderr };
}

function readSuccessfulJsonCapture(attemptDirectory, prefix) {
  const capture = readCapture(attemptDirectory, prefix);
  requireCondition(capture.exitCode === 0, 'AWS_CAPTURE', `${prefix} no terminó correctamente.`);
  try {
    return { capture, document: JSON.parse(capture.stdout.toString('utf8')) };
  } catch {
    fail('AWS_CAPTURE', `${prefix} no produjo JSON válido.`);
  }
}

function extractAwsRequestId(stderr) {
  const text = stderr.toString('utf8');
  const patterns = [
    /["']x-amzn-requestid["']\s*:\s*["']([A-Za-z0-9-]{8,128})["']/gi,
    /<RequestId>([A-Za-z0-9-]{8,128})<\/RequestId>/gi,
    /\bRequestId\s*[:=]\s*["']?([A-Za-z0-9-]{8,128})["']?/gi
  ];
  const matches = new Set();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) matches.add(match[1]);
  }
  requireCondition(matches.size === 1, 'ABSENCE_REQUEST_ID', 'El probe DescribeStacks debe capturar un único request ID del servicio.');
  return [...matches][0];
}

function absenceRecord(attemptDirectory, prefix, operation, attempt, identity, identityHash) {
  const capture = readCapture(attemptDirectory, prefix);
  const stderr = capture.stderr.toString('utf8');
  requireCondition(capture.exitCode !== 0 && capture.stdout.toString('utf8').trim() === '', 'ABSENCE_SOURCE', `${operation} no falló de forma cerrada.`);
  requireCondition(/ValidationError/i.test(stderr) && /does not exist/i.test(stderr), 'ABSENCE_SOURCE', `${operation} no demostró ausencia.`);
  return {
    operation,
    stackName: CONTRACT.stackName,
    profile: attempt.profile,
    region: attempt.region,
    identitySha256: identityHash,
    absent: true,
    errorCode: 'ValidationError',
    exitCode: capture.exitCode,
    requestId: operation === 'DescribeStacks' ? extractAwsRequestId(capture.stderr) : null,
    requestedAt: capture.requestedAt,
    respondedAt: capture.respondedAt,
    stdoutSha256: capture.stdoutSha256,
    stderrSha256: capture.stderrSha256
  };
}

function stackTemplateAbsenceRecord(attemptDirectory, prefix, attempt, identityHash, stackId) {
  const capture = readCapture(attemptDirectory, prefix);
  const stderr = capture.stderr.toString('utf8');
  requireCondition(capture.exitCode !== 0 && capture.stdout.toString('utf8').trim() === '', 'STACK_TEMPLATE', 'GetTemplate del stack no falló de forma cerrada.');
  requireCondition(/ValidationError/i.test(stderr), 'STACK_TEMPLATE', 'GetTemplate del stack no demostró ausencia de template aplicado.');
  return {
    operation: 'GetTemplate',
    stackId,
    profile: attempt.profile,
    region: attempt.region,
    identitySha256: identityHash,
    absent: true,
    errorCode: 'ValidationError',
    exitCode: capture.exitCode,
    requestedAt: capture.requestedAt,
    respondedAt: capture.respondedAt,
    stdoutSha256: capture.stdoutSha256,
    stderrSha256: capture.stderrSha256
  };
}

function buildSnapshot(attemptDirectory, prefix, purpose, attempt, identity, identityHash, createResponse) {
  const names = [
    'describe-change-set',
    'list-change-sets',
    'describe-stacks',
    'list-stack-resources',
    'get-change-template'
  ];
  const captures = Object.fromEntries(names.map((name) => [name, readSuccessfulJsonCapture(attemptDirectory, `${prefix}-${name}`)]));
  const stackTemplate = stackTemplateAbsenceRecord(attemptDirectory, `${prefix}-get-stack-template`, attempt, identityHash, createResponse.StackId);
  const remoteBody = captures['get-change-template'].document.TemplateBody;
  requireCondition(typeof remoteBody === 'string', 'TEMPLATE_REMOTE', 'GetTemplate debe devolver TemplateBody como texto UTF-8 exacto.');
  const remoteBytes = Buffer.from(remoteBody, 'utf8');
  const startedAt = names.map((name) => Date.parse(captures[name].capture.requestedAt)).reduce((minimum, value) => Math.min(minimum, value));
  const observedAt = [
    ...names.map((name) => Date.parse(captures[name].capture.respondedAt)),
    Date.parse(stackTemplate.respondedAt)
  ].reduce((maximum, value) => Math.max(maximum, value));
  return {
    purpose,
    startedAt: new Date(startedAt).toISOString().replace(/\.000Z$/, 'Z'),
    observedAt: new Date(observedAt).toISOString().replace(/\.000Z$/, 'Z'),
    identity,
    describeChangeSet: captures['describe-change-set'].document,
    listChangeSets: captures['list-change-sets'].document,
    describeStacks: captures['describe-stacks'].document,
    listStackResources: captures['list-stack-resources'].document,
    stackTemplateAbsence: stackTemplate,
    remoteTemplateBodyBase64: remoteBytes.toString('base64'),
    remoteTemplateSha256: sha256(remoteBytes)
  };
}

function verifyChain(attemptDirectory, chainPath) {
  requirePrivateDirectory(attemptDirectory);
  requirePrivateFile(chainPath);
  const manifest = readJson(chainPath, 'EVIDENCE_CHAIN');
  requireCondition(manifest.version === 1 && Array.isArray(manifest.entries) && manifest.entries.length > 0, 'EVIDENCE_CHAIN', 'La cadena no tiene el formato esperado.');
  for (const entry of manifest.entries) {
    requireCondition(typeof entry.path === 'string' && basename(entry.path) === entry.path && !entry.path.startsWith('.'), 'EVIDENCE_CHAIN', 'La cadena contiene una ruta inválida.');
    const path = join(attemptDirectory, entry.path);
    requirePrivateFile(path);
    requireCondition(sha256(readFileSync(path)) === entry.sha256, 'EVIDENCE_CHAIN', `Cambió ${entry.path} después del sellado.`);
  }
  const calculated = computeChainDigest(manifest.entries, manifest.previousChainFileSha256 ?? null);
  requireCondition(calculated === manifest.chainSha256, 'EVIDENCE_CHAIN', 'El hash encadenado no coincide.');
  return manifest;
}

function requireAttemptFile(attemptDirectory, path, expectedName, code = 'EVIDENCE_CHAIN') {
  const resolvedDirectory = realpathSync(attemptDirectory);
  const resolvedPath = resolve(path);
  requirePrivateFile(resolvedPath);
  requireCondition(
    realpathSync(resolvedPath) === join(resolvedDirectory, expectedName),
    code,
    `${expectedName} no pertenece al intento privado esperado.`
  );
  return resolvedPath;
}

function requireChainEntry(manifest, path) {
  const expectedHash = sha256(readFileSync(path));
  const matches = manifest.entries.filter((entry) => entry.path === basename(path));
  requireCondition(matches.length === 1 && matches[0].sha256 === expectedHash, 'EVIDENCE_CHAIN', `${basename(path)} no está sellado por la cadena revisada.`);
  return expectedHash;
}

function verifyChainLink(attemptDirectory, chainPath, previousPath, requiredPaths = []) {
  const manifest = verifyChain(attemptDirectory, chainPath);
  if (previousPath === null) {
    requireCondition(manifest.previousChainFileSha256 === null, 'EVIDENCE_CHAIN', `${basename(chainPath)} declara un predecesor inesperado.`);
  } else {
    const previousHash = sha256(readFileSync(previousPath));
    requireCondition(manifest.previousChainFileSha256 === previousHash, 'EVIDENCE_CHAIN', `${basename(chainPath)} no enlaza la cadena anterior exacta.`);
    requireChainEntry(manifest, previousPath);
  }
  const requiredHashes = Object.fromEntries(requiredPaths.map((path) => [basename(path), requireChainEntry(manifest, path)]));
  return { manifest, chainSha256: sha256(readFileSync(chainPath)), requiredHashes };
}

function verifyReviewedExecutionChain(args, phase) {
  const attemptDirectory = resolve(required(args, '--attempt-dir'));
  requirePrivateDirectory(attemptDirectory);
  const evidenceName = phase === 'prepare' ? 'proof-prepare.json' : 'proof-execute.json';
  const inputName = phase === 'prepare' ? 'chain-input-prepare.json' : 'chain-input-execute.json';
  const reviewedName = phase === 'prepare' ? 'chain-prepare.json' : 'chain-execute-reviewed.json';
  const evidencePath = requireAttemptFile(attemptDirectory, required(args, '--evidence'), evidenceName);
  const inputChainPath = requireAttemptFile(attemptDirectory, required(args, '--chain'), inputName);
  const reviewedChainPath = requireAttemptFile(attemptDirectory, required(args, '--reviewed-chain'), reviewedName);

  if (phase === 'prepare') {
    verifyChainLink(attemptDirectory, inputChainPath, null);
    const reviewed = verifyChainLink(attemptDirectory, reviewedChainPath, inputChainPath, [evidencePath]);
    return {
      attemptDirectory: realpathSync(attemptDirectory),
      evidencePath,
      evidenceSha256: reviewed.requiredHashes[evidenceName],
      inputChainPath,
      inputChainSha256: sha256(readFileSync(inputChainPath)),
      reviewedChainPath,
      reviewedChainSha256: reviewed.chainSha256
    };
  }

  const prepareEvidencePath = requireAttemptFile(attemptDirectory, required(args, '--prepare-evidence'), 'proof-prepare.json');
  const prepareInputPath = requireAttemptFile(attemptDirectory, join(attemptDirectory, 'chain-input-prepare.json'), 'chain-input-prepare.json');
  const prepareReviewedPath = requireAttemptFile(attemptDirectory, required(args, '--previous-chain'), 'chain-prepare.json');
  verifyChainLink(attemptDirectory, prepareInputPath, null);
  verifyChainLink(attemptDirectory, prepareReviewedPath, prepareInputPath, [prepareEvidencePath]);
  verifyChainLink(attemptDirectory, inputChainPath, prepareReviewedPath);
  const reviewed = verifyChainLink(attemptDirectory, reviewedChainPath, inputChainPath, [evidencePath]);
  return {
    attemptDirectory: realpathSync(attemptDirectory),
    evidencePath,
    evidenceSha256: reviewed.requiredHashes[evidenceName],
    inputChainPath,
    inputChainSha256: sha256(readFileSync(inputChainPath)),
    reviewedChainPath,
    reviewedChainSha256: reviewed.chainSha256
  };
}

function readBoundExecution(args, evidence) {
  const attemptDirectory = resolve(required(args, '--attempt-dir'));
  requirePrivateDirectory(attemptDirectory);
  const pointerPath = resolve(required(args, '--pointer'));
  requirePrivateFile(pointerPath);
  requireCondition(basename(pointerPath) === '.aws-change-set.json', 'EXECUTE_BINDING', 'El puntero privado no tiene el nombre esperado.');
  const attemptPath = requireAttemptFile(attemptDirectory, required(args, '--attempt'), 'attempt.json', 'EXECUTE_BINDING');
  const prepareEvidencePath = requireAttemptFile(attemptDirectory, required(args, '--prepare-evidence'), 'proof-prepare.json', 'EXECUTE_BINDING');
  const pointer = readJson(pointerPath, 'EXECUTE_BINDING');
  const attempt = readJson(attemptPath, 'EXECUTE_BINDING');
  const prepareEvidenceBytes = readFileSync(prepareEvidencePath);
  const prepareEvidence = readJson(prepareEvidencePath, 'EXECUTE_BINDING');
  const context = requireObject(prepareEvidence.context, 'EXECUTE_BINDING', 'El contexto prepare sellado');
  const response = requireObject(prepareEvidence.create?.response, 'EXECUTE_BINDING', 'La respuesta prepare sellada');
  const template = requireObject(prepareEvidence.template, 'EXECUTE_BINDING', 'La plantilla prepare sellada');
  const expectedProfile = required(args, '--expected-profile');
  const expectedRegion = required(args, '--expected-region');
  const expectedCommitSha = required(args, '--expected-commit-sha');
  const expectedIdentitySha = required(args, '--expected-identity-sha');
  const currentTemplate = readFileSync(required(args, '--template'));
  const expectedTemplateSha = sha256(currentTemplate);
  const prepareEvidenceSha256 = sha256(prepareEvidenceBytes);
  const canonicalAttemptDirectory = realpathSync(attemptDirectory);
  let pointerAttemptDirectory;
  try {
    requireCondition(typeof pointer.attemptDirectory === 'string', 'EXECUTE_BINDING', 'El puntero no contiene attemptDirectory.');
    pointerAttemptDirectory = realpathSync(pointer.attemptDirectory);
  } catch (error) {
    if (error instanceof ProofValidationError) throw error;
    fail('EXECUTE_BINDING', 'El attemptDirectory del puntero no existe o no es accesible.');
  }

  requireCondition(prepareEvidence.phase === 'prepare', 'EXECUTE_BINDING', 'La evidencia base no es proof-prepare.json.');
  const attemptFields = [
    'schemaVersion', 'attemptId', 'createdAt', 'project', 'repository', 'stackName', 'environment',
    'priceClass', 'profile', 'region', 'commitSha', 'confirmedCommitSha', 'confirmedIdentitySha',
    'templateSha256', 'templateByteLength', 'changeSetName', 'clientToken', 'gitClean'
  ];
  requireCondition(attemptFields.every((field) => attempt[field] === context[field]), 'EXECUTE_BINDING', 'attempt.json no coincide exactamente con el contexto prepare sellado.');
  requireCondition(
    context.stackName === CONTRACT.stackName && context.stackName !== CONTRACT.blockedStackName &&
    context.profile === expectedProfile && context.region === expectedRegion &&
    context.commitSha === expectedCommitSha && context.confirmedCommitSha === expectedCommitSha &&
    context.identitySha256 === expectedIdentitySha && context.confirmedIdentitySha === expectedIdentitySha &&
    context.templateSha256 === expectedTemplateSha && template.localSha256 === expectedTemplateSha &&
    context.templateByteLength === currentTemplate.length,
    'EXECUTE_BINDING',
    'El contexto prepare no coincide con target, profile, región, commit, identidad o plantilla aprobados.'
  );
  requireCondition(
    pointerAttemptDirectory === canonicalAttemptDirectory &&
    pointer.attemptId === context.attemptId && pointer.stackName === CONTRACT.stackName &&
    pointer.stackId === response.stackId && pointer.changeSetName === context.changeSetName &&
    pointer.changeSetId === response.changeSetId && pointer.clientToken === context.clientToken &&
    pointer.profile === context.profile && pointer.region === context.region &&
    pointer.commitSha === context.commitSha && pointer.identitySha256 === context.identitySha256 &&
    pointer.templateSha256 === expectedTemplateSha && pointer.prepareEvidenceSha256 === prepareEvidenceSha256,
    'EXECUTE_BINDING',
    'El puntero, attempt.json y proof-prepare.json no coinciden exactamente.'
  );

  if (evidence.phase === 'execute') {
    const historicalSectionsMatch =
      canonicalJson(evidence.context) === canonicalJson(prepareEvidence.context) &&
      canonicalJson(evidence.template) === canonicalJson(prepareEvidence.template) &&
      canonicalJson(evidence.identity) === canonicalJson(prepareEvidence.identity) &&
      canonicalJson(evidence.preflight) === canonicalJson(prepareEvidence.preflight) &&
      canonicalJson(evidence.create) === canonicalJson(prepareEvidence.create) &&
      canonicalJson(evidence.snapshots?.prepare) === canonicalJson(prepareEvidence.snapshots?.prepare);
    requireCondition(historicalSectionsMatch, 'EXECUTE_BINDING', 'proof-execute.json no conserva exactamente la evidencia prepare sellada.');
  } else {
    requireCondition(evidence.phase === 'prepare' && canonicalJson(evidence) === canonicalJson(prepareEvidence), 'EXECUTE_BINDING', 'El guard previo no recibió proof-prepare.json.');
  }

  const executionResponse = requireObject(evidence.create?.response, 'EXECUTE_BINDING', 'La respuesta de ejecución sellada');
  requireCondition(
    executionResponse.stackId === response.stackId && executionResponse.changeSetId === response.changeSetId,
    'EXECUTE_BINDING',
    'Los IDs ejecutables no coinciden con proof-prepare.json.'
  );
  return {
    stackId: executionResponse.stackId,
    changeSetId: executionResponse.changeSetId,
    changeSetName: evidence.context.changeSetName,
    clientToken: evidence.context.clientToken,
    prepareEvidenceSha256
  };
}

function commandInit(args) {
  const attemptsRoot = resolve(required(args, '--attempts-root'));
  const templatePath = resolve(required(args, '--template'));
  if (!existsSync(attemptsRoot)) mkdirSync(attemptsRoot, { mode: 0o700 });
  chmodSync(attemptsRoot, 0o700);
  requirePrivateDirectory(attemptsRoot);
  requireCondition(readdirSync(attemptsRoot).length === 0, 'ATTEMPT_EXISTS', 'Un intento anterior permanece preservado; no se inicia otro automáticamente.');
  const templateBytes = readFileSync(templatePath);
  const record = createAttemptRecord({
    profile: required(args, '--profile'),
    region: required(args, '--region'),
    commitSha: required(args, '--commit-sha'),
    confirmedCommitSha: required(args, '--confirm-commit-sha'),
    confirmedIdentitySha: required(args, '--confirm-identity-sha'),
    templateBytes,
    uuidFactory: randomUUID
  });
  const attemptDirectory = join(attemptsRoot, record.attemptId);
  mkdirSync(attemptDirectory, { mode: 0o700 });
  chmodSync(attemptDirectory, 0o700);
  writeExclusive(join(attemptDirectory, 'submitted-template.yaml'), templateBytes);
  writeExclusiveJson(join(attemptDirectory, 'attempt.json'), record);
  process.stdout.write(`${attemptDirectory}\n`);
}

function commandCaptureRecord(args) {
  const output = resolve(required(args, '--output'));
  const stdoutPath = resolve(required(args, '--stdout'));
  const stderrPath = resolve(required(args, '--stderr'));
  requirePrivateFile(stdoutPath);
  requirePrivateFile(stderrPath);
  const exitCode = Number(required(args, '--exit-code'));
  requireCondition(Number.isInteger(exitCode) && exitCode >= 0, 'CAPTURE', 'El exit code no es válido.');
  writeExclusiveJson(output, {
    requestedAt: required(args, '--requested-at'),
    respondedAt: required(args, '--responded-at'),
    exitCode,
    stdoutSha256: sha256(readFileSync(stdoutPath)),
    stderrSha256: sha256(readFileSync(stderrPath))
  });
}

function commandNormalizeIdentity(args) {
  const attempt = readJson(required(args, '--attempt'), 'ATTEMPT');
  const identity = normalizeIdentity(readJson(required(args, '--identity'), 'IDENTITY'), attempt);
  writeExclusiveJson(resolve(required(args, '--output')), identity);
}

function commandCreateRequest(args) {
  const attempt = readJson(required(args, '--attempt'), 'ATTEMPT');
  const identity = normalizeIdentity(readJson(required(args, '--identity'), 'IDENTITY'), attempt);
  const deploymentId = deriveDeploymentId(identity.accountId, attempt.region);
  const request = {
    operation: 'CreateChangeSet',
    requestedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    profile: attempt.profile,
    region: attempt.region,
    stackName: CONTRACT.stackName,
    changeSetName: attempt.changeSetName,
    changeSetType: 'CREATE',
    clientToken: attempt.clientToken,
    description: `Calculadora de Varillas template ${attempt.templateSha256}`,
    onStackFailure: 'DO_NOTHING',
    disableRollback: false,
    includeNestedStacks: false,
    importExistingResources: false,
    capabilities: [],
    notificationArns: [],
    roleArn: null,
    resourceTypes: [],
    resourcesToImport: [],
    rollbackConfiguration: null,
    templateUrl: null,
    templateSha256: attempt.templateSha256,
    parameters: [
      { ParameterKey: 'ProjectSlug', ParameterValue: CONTRACT.project },
      { ParameterKey: 'Environment', ParameterValue: CONTRACT.environment },
      { ParameterKey: 'DeploymentId', ParameterValue: deploymentId },
      { ParameterKey: 'PriceClass', ParameterValue: CONTRACT.priceClass }
    ],
    tags: [
      { Key: 'Project', Value: CONTRACT.project },
      { Key: 'Environment', Value: CONTRACT.environment },
      { Key: 'ManagedBy', Value: 'CloudFormation' },
      { Key: 'Repository', Value: CONTRACT.repository },
      { Key: 'DeploymentId', Value: deploymentId }
    ]
  };
  writeExclusiveJson(resolve(required(args, '--output')), request);
}

function commandSelectCloudTrail(args) {
  const attempt = readJson(required(args, '--attempt'), 'ATTEMPT');
  const identity = normalizeIdentity(readJson(required(args, '--identity'), 'IDENTITY'), attempt);
  const lookup = readJson(required(args, '--input'), 'CLOUDTRAIL_EVENTS');
  requireCondition(Array.isArray(lookup.Events), 'CLOUDTRAIL_EVENTS', 'LookupEvents no devolvió Events.');
  const kind = required(args, '--kind');
  let expectedRequestId = null;
  if (kind === 'absence') {
    const attemptDirectory = resolve(required(args, '--attempt-dir'));
    requirePrivateDirectory(attemptDirectory);
    expectedRequestId = absenceRecord(
      attemptDirectory,
      required(args, '--probe-prefix'),
      'DescribeStacks',
      attempt,
      identity,
      identitySha256(identity)
    ).requestId;
  }
  const selected = selectCloudTrailEvent(lookup.Events, {
    kind,
    context: attempt,
    identity,
    expectedRequestId
  });
  writeExclusiveJson(resolve(required(args, '--output')), selected);
}

function commandSeal(args) {
  const attemptDirectory = resolve(required(args, '--attempt-dir'));
  requirePrivateDirectory(attemptDirectory);
  const outputName = required(args, '--output-name');
  requireCondition(basename(outputName) === outputName && !outputName.startsWith('.'), 'PATH_SCOPE', 'El nombre del sello no es válido.');
  const output = join(attemptDirectory, outputName);
  requireCondition(!existsSync(output), 'WRITE_ONCE', 'El sello ya existe.');
  let previousChainFileSha256 = null;
  if (args.has('--previous')) {
    const previous = resolve(required(args, '--previous'));
    requirePrivateFile(previous);
    previousChainFileSha256 = sha256(readFileSync(previous));
  }
  const entries = readdirSync(attemptDirectory).sort().filter((name) => name !== outputName).map((name) => {
    requireCondition(basename(name) === name && !name.startsWith('.'), 'EVIDENCE_CHAIN', 'El intento contiene una ruta no permitida.');
    const path = join(attemptDirectory, name);
    requirePrivateFile(path);
    return { path: name, sha256: sha256(readFileSync(path)) };
  });
  const manifest = {
    version: 1,
    previousChainFileSha256,
    entries,
    chainSha256: computeChainDigest(entries, previousChainFileSha256)
  };
  writeExclusiveJson(output, manifest);
}

function commandBuild(args) {
  const phase = required(args, '--phase');
  requireCondition(phase === 'prepare' || phase === 'execute', 'PHASE', 'La fase de build no es válida.');
  const attemptDirectory = resolve(required(args, '--attempt-dir'));
  requirePrivateDirectory(attemptDirectory);
  const attempt = readJson(join(attemptDirectory, 'attempt.json'), 'ATTEMPT');
  const identity = normalizeIdentity(readJson(join(attemptDirectory, 'identity.json'), 'IDENTITY'), attempt);
  const identityHash = identitySha256(identity);
  requireCondition(identityHash === attempt.confirmedIdentitySha, 'IDENTITY_CONFIRMATION', 'La identidad no coincide con la confirmación aprobada.');
  const submittedTemplate = readFileSync(join(attemptDirectory, 'submitted-template.yaml'));
  const commitTemplate = readFileSync(join(attemptDirectory, 'commit-template.yaml'));
  validateCanonicalTemplateBytes(submittedTemplate);
  requireCondition(submittedTemplate.equals(commitTemplate), 'TEMPLATE_COMMIT_MISMATCH', 'La plantilla no coincide con el commit.');
  const createRequest = readJson(join(attemptDirectory, 'create-request.json'), 'CREATE_REQUEST');
  const createCapture = readSuccessfulJsonCapture(attemptDirectory, 'create-change-set');
  const createResponse = createCapture.document;
  requireCondition(typeof createResponse.Id === 'string' && typeof createResponse.StackId === 'string', 'CREATE_RESPONSE', 'CreateChangeSet no devolvió IDs.');
  const absenceTrail = normalizeCloudTrailEvent(readJson(join(attemptDirectory, 'cloudtrail-describe-event.json'), 'CLOUDTRAIL_EVENT'));
  const createTrail = normalizeCloudTrailEvent(readJson(join(attemptDirectory, 'cloudtrail-create-event.json'), 'CLOUDTRAIL_EVENT'));
  const inputChainPath = resolve(required(args, '--input-chain'));
  verifyChain(attemptDirectory, inputChainPath);
  const context = {
    ...attempt,
    identitySha256: identityHash,
    deploymentId: deriveDeploymentId(identity.accountId, attempt.region)
  };
  const proof = {
    schemaVersion: CONTRACT.schemaVersion,
    phase,
    context,
    integrity: { inputChainSha256: sha256(readFileSync(inputChainPath)) },
    template: {
      localBodyBase64: submittedTemplate.toString('base64'),
      commitBodyBase64: commitTemplate.toString('base64'),
      localSha256: sha256(submittedTemplate),
      commitSha256: sha256(commitTemplate),
      byteLength: submittedTemplate.length
    },
    identity,
    preflight: {
      describeStacks: absenceRecord(attemptDirectory, 'preflight-describe-stacks', 'DescribeStacks', attempt, identity, identityHash),
      listChangeSets: absenceRecord(attemptDirectory, 'preflight-list-change-sets', 'ListChangeSets', attempt, identity, identityHash),
      cloudTrailDescribeStacks: { ...absenceTrail, stackName: absenceTrail.requestParameters.stackName }
    },
    create: {
      request: createRequest,
      response: {
        changeSetId: createResponse.Id,
        stackId: createResponse.StackId,
        requestedAt: createCapture.capture.requestedAt,
        respondedAt: createCapture.capture.respondedAt,
        stdoutSha256: createCapture.capture.stdoutSha256,
        stderrSha256: createCapture.capture.stderrSha256
      },
      cloudTrailCreateChangeSet: createTrail
    },
    snapshots: {
      prepare: buildSnapshot(attemptDirectory, 'prepare', 'prepare-review', attempt, identity, identityHash, createResponse)
    }
  };
  if (phase === 'execute') {
    const toctouIdentity = normalizeIdentity(readJson(join(attemptDirectory, 'toctou-identity.stdout'), 'IDENTITY'), attempt);
    requireCondition(identitySha256(toctouIdentity) === identityHash, 'SNAPSHOT_IDENTITY', 'La identidad cambió antes de execute.');
    proof.snapshots.toctou = buildSnapshot(attemptDirectory, 'toctou', 'before-execute', attempt, toctouIdentity, identityHash, createResponse);
  }
  writeExclusiveJson(resolve(required(args, '--output')), proof);
}

function validateEvidence(args, now = new Date(), includeExecutionBinding = true) {
  const evidencePath = resolve(required(args, '--evidence'));
  const chainPath = resolve(required(args, '--chain'));
  const attemptDirectory = dirname(evidencePath);
  verifyChain(attemptDirectory, chainPath);
  const evidence = readJson(evidencePath, 'EVIDENCE');
  const validationOptions = {
    phase: required(args, '--phase'),
    templateBytes: readFileSync(required(args, '--template')),
    commitTemplateBytes: readFileSync(required(args, '--commit-template')),
    expectedCommitSha: required(args, '--expected-commit-sha'),
    expectedIdentitySha: required(args, '--expected-identity-sha'),
    inputChainSha256: sha256(readFileSync(chainPath)),
    now
  };
  if (includeExecutionBinding && (args.has('--pointer') || args.has('--attempt'))) {
    const pointerPath = resolve(required(args, '--pointer'));
    const attemptPath = resolve(required(args, '--attempt'));
    requirePrivateFile(pointerPath);
    requirePrivateFile(attemptPath);
    validationOptions.executionBinding = {
      pointer: readJson(pointerPath, 'EXECUTE_BINDING'),
      attempt: readJson(attemptPath, 'EXECUTE_BINDING')
    };
  }
  const summary = validateAwsProof(evidence, validationOptions);
  return { evidence, evidencePath, chainPath, summary };
}

function commandValidate(args) {
  const now = args.has('--now') ? required(args, '--now') : new Date();
  const { summary } = validateEvidence(args, now);
  if (args.has('--summary-output')) writeExclusiveJson(resolve(required(args, '--summary-output')), summary);
  process.stdout.write('AWS proof: PASS\n');
}

function commandGuardPrepare(args) {
  requireCondition(required(args, '--phase') === 'prepare', 'PHASE', 'El guard previo solo admite prepare.');
  const chain = verifyReviewedExecutionChain(args, 'prepare');
  const preview = readJson(chain.evidencePath, 'EVIDENCE');
  const observedAt = preview.snapshots?.prepare?.observedAt;
  requireCondition(typeof observedAt === 'string', 'EXECUTE_BINDING', 'proof-prepare.json no contiene el snapshot revisado.');
  const { evidence, summary } = validateEvidence(args, observedAt, false);
  const execution = readBoundExecution(args, evidence);
  requireCondition(sha256(readFileSync(chain.evidencePath)) === chain.evidenceSha256, 'EVIDENCE_CHAIN', 'proof-prepare.json cambió durante el guard previo.');
  requireCondition(sha256(readFileSync(chain.reviewedChainPath)) === chain.reviewedChainSha256, 'EVIDENCE_CHAIN', 'chain-prepare.json cambió durante el guard previo.');
  writeExclusiveJson(resolve(required(args, '--output')), {
    prepareEvidenceSha256: chain.evidenceSha256,
    inputChainSha256: chain.inputChainSha256,
    reviewedChainSha256: chain.reviewedChainSha256,
    execution,
    checks: summary
  });
}

function commandGuardExecute(args) {
  requireCondition(required(args, '--phase') === 'execute', 'PHASE', 'El guard final solo admite execute.');
  const requestedAt = required(args, '--requested-at');
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(requestedAt) && Number.isFinite(Date.parse(requestedAt)), 'EXECUTE_TIME', 'El inicio de execute debe ser UTC.');
  const chain = verifyReviewedExecutionChain(args, 'execute');
  const { evidence, evidencePath, summary } = validateEvidence(args, requestedAt);
  const execution = readBoundExecution(args, evidence);
  requireCondition(sha256(readFileSync(chain.evidencePath)) === chain.evidenceSha256, 'EVIDENCE_CHAIN', 'proof-execute.json cambió durante el guard final.');
  requireCondition(sha256(readFileSync(chain.reviewedChainPath)) === chain.reviewedChainSha256, 'EVIDENCE_CHAIN', 'chain-execute-reviewed.json cambió durante el guard final.');
  writeExclusiveJson(resolve(required(args, '--output')), {
    requestedAt,
    toctouObservedAt: evidence.snapshots.toctou.observedAt,
    evidenceSha256: sha256(readFileSync(evidencePath)),
    inputChainSha256: chain.inputChainSha256,
    reviewedChainSha256: chain.reviewedChainSha256,
    execution,
    checks: summary
  });
}

function commandVerifyExecuteCapture(args) {
  const guardPath = resolve(required(args, '--guard'));
  const capturePath = resolve(required(args, '--capture'));
  const evidencePath = resolve(required(args, '--evidence'));
  const reviewedChainPath = resolve(required(args, '--reviewed-chain'));
  requirePrivateFile(guardPath);
  requirePrivateFile(capturePath);
  requirePrivateFile(evidencePath);
  requirePrivateFile(reviewedChainPath);
  const guard = readJson(guardPath, 'EXECUTE_GUARD');
  const capture = readJson(capturePath, 'EXECUTE_CAPTURE');
  requireCondition(guard.requestedAt === capture.requestedAt, 'EXECUTE_CORRELATION', 'El guard final no corresponde al inicio capturado de execute-change-set.');
  requireCondition(guard.evidenceSha256 === sha256(readFileSync(evidencePath)), 'EXECUTE_CORRELATION', 'La evidencia validada por el guard final cambió.');
  requireCondition(guard.reviewedChainSha256 === sha256(readFileSync(reviewedChainPath)), 'EXECUTE_CORRELATION', 'La cadena revisada por el guard final cambió.');
  requireCondition(Date.parse(capture.requestedAt) <= Date.parse(capture.respondedAt), 'EXECUTE_CORRELATION', 'La captura de execute-change-set tiene un intervalo inválido.');
}

function commandReport(args) {
  const evidencePath = resolve(required(args, '--evidence'));
  const chainPath = resolve(required(args, '--chain'));
  const evidence = readJson(evidencePath, 'EVIDENCE');
  const summary = readJson(required(args, '--summary'), 'REPORT');
  const report = buildShareableReport({
    evidenceBytes: readFileSync(evidencePath),
    chainBytes: readFileSync(chainPath),
    proofSummary: summary,
    templateSha256: evidence.template.localSha256,
    commitSha: evidence.context.commitSha,
    identityHash: evidence.context.identitySha256
  });
  validateShareableReport(report);
  writeExclusiveJson(resolve(required(args, '--output')), report);
}

function commandPointer(args) {
  const evidence = readJson(required(args, '--evidence'), 'EVIDENCE');
  const attemptDirectory = resolve(required(args, '--attempt-dir'));
  requirePrivateDirectory(attemptDirectory);
  writeExclusiveJson(resolve(required(args, '--output')), {
    attemptDirectory,
    attemptId: evidence.context.attemptId,
    stackName: evidence.context.stackName,
    stackId: evidence.create.response.stackId,
    changeSetName: evidence.context.changeSetName,
    changeSetId: evidence.create.response.changeSetId,
    clientToken: evidence.context.clientToken,
    profile: evidence.context.profile,
    region: evidence.context.region,
    commitSha: evidence.context.commitSha,
    identitySha256: evidence.context.identitySha256,
    templateSha256: evidence.template.localSha256,
    prepareEvidenceSha256: sha256(readFileSync(required(args, '--evidence')))
  });
}

function commandCheckPermissions(args) {
  const attemptDirectory = resolve(required(args, '--attempt-dir'));
  requirePrivateDirectory(attemptDirectory);
  for (const name of readdirSync(attemptDirectory)) requirePrivateFile(join(attemptDirectory, name));
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArguments(rest);

try {
  switch (command) {
    case 'check-template':
      validateCanonicalTemplateBytes(readFileSync(required(args, '--template')));
      process.stdout.write('Template bytes: PASS\n');
      break;
    case 'check-skeleton':
      validateCliSkeleton(readJson(required(args, '--skeleton'), 'CLI_SKELETON'));
      process.stdout.write('AWS CLI skeleton: PASS\n');
      break;
    case 'identity-hash': {
      const attempt = readJson(required(args, '--attempt'), 'ATTEMPT');
      const identity = normalizeIdentity(readJson(required(args, '--identity'), 'IDENTITY'), attempt);
      process.stdout.write(`${identitySha256(identity)}\n`);
      break;
    }
    case 'init-attempt': commandInit(args); break;
    case 'capture-record': commandCaptureRecord(args); break;
    case 'normalize-identity': commandNormalizeIdentity(args); break;
    case 'create-request': commandCreateRequest(args); break;
    case 'select-cloudtrail': commandSelectCloudTrail(args); break;
    case 'seal': commandSeal(args); break;
    case 'verify-chain':
      verifyChain(resolve(required(args, '--attempt-dir')), resolve(required(args, '--chain')));
      process.stdout.write('Evidence chain: PASS\n');
      break;
    case 'build': commandBuild(args); break;
    case 'validate': commandValidate(args); break;
    case 'guard-prepare': commandGuardPrepare(args); break;
    case 'guard-execute': commandGuardExecute(args); break;
    case 'verify-execute-capture': commandVerifyExecuteCapture(args); break;
    case 'report': commandReport(args); break;
    case 'pointer': commandPointer(args); break;
    case 'check-permissions': commandCheckPermissions(args); break;
    case 'check-absence': {
      const attempt = readJson(required(args, '--attempt'), 'ATTEMPT');
      const identity = normalizeIdentity(readJson(required(args, '--identity'), 'IDENTITY'), attempt);
      const hash = identitySha256(identity);
      absenceRecord(required(args, '--attempt-dir'), required(args, '--prefix'), required(args, '--operation'), attempt, identity, hash);
      process.stdout.write('Absence probe: PASS\n');
      break;
    }
    default:
      fail('ARGUMENTS', 'Comando no reconocido.');
  }
} catch (error) {
  if (error instanceof ProofValidationError) {
    process.stderr.write(`ERROR [${error.code}]: ${error.message}\n`);
    process.exitCode = error.code === 'CLOUDTRAIL_NOT_FOUND' ? 3 : error.code === 'CLOUDTRAIL_AMBIGUOUS' ? 2 : 1;
  } else {
    process.stderr.write('ERROR [INTERNAL]: el validador local no pudo completar la operación.\n');
    process.exitCode = 1;
  }
}
