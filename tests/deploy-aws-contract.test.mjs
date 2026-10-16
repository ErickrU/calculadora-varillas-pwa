import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CONTRACT,
  buildShareableReport,
  createAttemptRecord,
  identitySha256,
  sha256,
  validateCliSkeleton,
  validateShareableReport
} from '../scripts/aws-proof.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const script = readFileSync(join(root, 'scripts', 'deploy-aws.sh'), 'utf8');
const cli = join(root, 'scripts', 'validate-aws-proof.mjs');

function mode(path) {
  return statSync(path).mode & 0o777;
}

function writePrivate(path, value) {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function writePrivateJson(path, value) {
  writePrivate(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeCapture(directory, prefix, { stdout = '', stderr = '', exitCode, requestedAt, respondedAt }) {
  const stdoutBytes = Buffer.from(stdout);
  const stderrBytes = Buffer.from(stderr);
  writePrivate(join(directory, `${prefix}.stdout`), stdoutBytes);
  writePrivate(join(directory, `${prefix}.stderr`), stderrBytes);
  writePrivateJson(join(directory, `${prefix}.capture.json`), {
    requestedAt,
    respondedAt,
    exitCode,
    stdoutSha256: sha256(stdoutBytes),
    stderrSha256: sha256(stderrBytes)
  });
}

function runCli(argumentsList) {
  return spawnSync(process.execPath, [cli, ...argumentsList], { encoding: 'utf8' });
}

function utc(base, seconds) {
  return new Date(base + (seconds * 1000)).toISOString().replace('.000Z', 'Z');
}

test('el target v2 y sus parámetros de producción están fijados internamente', () => {
  assert.equal(CONTRACT.stackName, 'calculadora-varillas-pwa-public-prod-v2');
  assert.equal(CONTRACT.blockedStackName, 'calculadora-varillas-pwa-public-prod');
  assert.match(script, /^TARGET_STACK='calculadora-varillas-pwa-public-prod-v2'$/m);
  assert.match(script, /^BLOCKED_STACK='calculadora-varillas-pwa-public-prod'$/m);
  assert.match(script, /^ENVIRONMENT='prod'$/m);
  assert.match(script, /^PRICE_CLASS='PriceClass_100'$/m);
  assert.match(script, /\[\[ "\$TARGET_STACK" != "\$BLOCKED_STACK" \]\]/);
  assert.doesNotMatch(script, /--stack\)/);
  assert.doesNotMatch(script, /--environment\)/);
  assert.doesNotMatch(script, /--price-class\)/);
  assert.match(script, /el resultado siempre es STOP/);
  assert.doesNotMatch(script, /cloudformation\s+(?:delete-stack|update-stack)/);
});

test('ninguna llamada futura puede usar el nombre bloqueado', () => {
  const commandLines = script.split('\n').filter((line) => line.includes('${AWS[@]}') || line.includes('--stack-name'));
  assert.ok(commandLines.some((line) => line.includes('$TARGET_STACK')));
  assert.equal(commandLines.some((line) => line.includes('$BLOCKED_STACK')), false);
  assert.doesNotMatch(script, /--stack-name\s+['"]?calculadora-varillas-pwa-public-prod['"]?(?:\s|$)/);
  assert.doesNotMatch(script, /delete-change-set|delete-stack|update-stack/);
});

test('create-change-set usa CREATE, token interno y DO_NOTHING sin DisableRollback', () => {
  const block = script.match(/capture_command create-change-set[\s\S]+?require_capture_success 'No se pudo preparar el change set;/)?.[0];
  assert.ok(block, 'debe existir el bloque literal de creación');
  assert.match(block, /--stack-name "\$TARGET_STACK"/);
  assert.match(block, /--change-set-type CREATE/);
  assert.match(block, /--client-token "\$CLIENT_TOKEN"/);
  assert.match(block, /--on-stack-failure DO_NOTHING/);
  assert.match(block, /--change-set-name "\$CHANGE_SET_NAME"/);
  assert.match(block, /--description "Calculadora de Varillas template \$TEMPLATE_SHA"/);
  assert.doesNotMatch(block, /--disable-rollback/i);
  assert.doesNotMatch(block, /--(?:capabilities|include-nested-stacks|import-existing-resources|notification-arns|resource-types|resources-to-import|role-arn|rollback-configuration|template-url)\b/i);
});

test('normaliza la identidad y captura el request ID antes de crear', () => {
  const normalizeIndex = script.indexOf('normalize-identity');
  const createIndex = script.indexOf('capture_command create-change-set');
  assert.ok(normalizeIndex >= 0 && normalizeIndex < createIndex);
  assert.match(script, /capture_command preflight-describe-stacks "\$\{AWS\[@\]\}" --debug cloudformation describe-stacks/);
  assert.match(script, /--probe-prefix preflight-describe-stacks/);
  assert.match(script, /--identity "\$ATTEMPT_DIR\/identity\.json"/);
});

test('vincula el puntero antes de AWS y sella la prueba TOCTOU usada por execute', () => {
  const executeStart = script.indexOf('[[ -f "$CHANGE_STATE"');
  const prepareGuardIndex = script.indexOf('guard-prepare', executeStart);
  const firstExecuteAwsIndex = script.indexOf('capture_command toctou-identity', executeStart);
  assert.ok(executeStart >= 0 && prepareGuardIndex > executeStart && prepareGuardIndex < firstExecuteAwsIndex);
  const prepareBlock = script.slice(executeStart, firstExecuteAwsIndex);
  assert.match(prepareBlock, /! -L "\$CHANGE_STATE"/);
  assert.match(prepareBlock, /--reviewed-chain "\$ATTEMPT_DIR\/chain-prepare\.json"/);
  assert.match(prepareBlock, /--prepare-evidence "\$ATTEMPT_DIR\/proof-prepare\.json"/);
  assert.match(prepareBlock, /STACK_ID="\$\(jq -er '\.execution\.stackId' "\$ATTEMPT_DIR\/execute-prepare-guard\.json"\)"/);
  assert.match(prepareBlock, /CHANGE_SET_ID="\$\(jq -er '\.execution\.changeSetId' "\$ATTEMPT_DIR\/execute-prepare-guard\.json"\)"/);
  assert.doesNotMatch(script, /(?:STACK_ID|CHANGE_SET_ID)="\$\(jq -er '\.(?:stackId|changeSetId)' "\$CHANGE_STATE"\)"/);

  const block = script.match(/INITIAL_GUARD_AT="\$\(utc_now\)"[\s\S]+?require_capture_success 'CloudFormation no aceptó la ejecución;/)?.[0];
  assert.ok(block, 'debe existir el guard final ligado a execute');
  assert.match(block, /guard-execute[\s\S]+?--requested-at "\$INITIAL_GUARD_AT"/);
  assert.match(block, /--pointer "\$CHANGE_STATE"/);
  assert.match(block, /--attempt "\$ATTEMPT_DIR\/attempt\.json"/);
  assert.match(block, /--prepare-evidence "\$ATTEMPT_DIR\/proof-prepare\.json"/);
  assert.match(block, /--reviewed-chain "\$ATTEMPT_DIR\/chain-execute-reviewed\.json"/);
  assert.match(block, /--previous-chain "\$ATTEMPT_DIR\/chain-prepare\.json"/);
  assert.match(block, /CLIENT_TOKEN="\$\(jq -er '\.execution\.clientToken' "\$ATTEMPT_DIR\/execute-guard\.json"\)"/);
  assert.match(block, /EXECUTE_REQUESTED_AT="\$\([\s\S]+?guard-execute[\s\S]+?--output "\$ATTEMPT_DIR\/execute-launch-guard\.json"[\s\S]+?\)"/);
  assert.match(block, /capture_command_at execute-change-set "\$EXECUTE_REQUESTED_AT"/);
  assert.match(block, /verify-execute-capture[\s\S]+?--reviewed-chain "\$ATTEMPT_DIR\/chain-execute-reviewed\.json"/);
  assert.doesNotMatch(script, /CLIENT_TOKEN="\$\(jq -er '\.clientToken' "\$CHANGE_STATE"\)"/);
  assert.ok(block.indexOf('guard-execute') < block.indexOf("'.execution.clientToken'"));
  assert.ok(block.indexOf("'.execution.clientToken'") < block.indexOf('EXECUTE_REQUESTED_AT="$('));
  assert.ok(block.indexOf('EXECUTE_REQUESTED_AT="$(') < block.indexOf('capture_command_at execute-change-set'));
  const launchBlock = block.slice(block.indexOf('EXECUTE_REQUESTED_AT="$('), block.indexOf('capture_command_at execute-change-set'));
  assert.doesNotMatch(launchBlock, /--requested-at|\butc_now\b|\bjq\b/);
  assert.doesNotMatch(block, /\b(?:report|seal)\b/);
});

test('el nombre y token se generan una vez y no aceptan entrada externa', () => {
  const values = [
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    'ffffffff-aaaa-4bbb-8ccc-dddddddddddd'
  ];
  const template = Buffer.from('Resources:\n', 'ascii');
  const record = createAttemptRecord({
    profile: 'fixture-profile',
    region: 'us-east-1',
    commitSha: 'a'.repeat(40),
    confirmedCommitSha: 'a'.repeat(40),
    confirmedIdentitySha: 'b'.repeat(64),
    templateBytes: template,
    now: new Date('2026-10-16T12:00:00Z'),
    uuidFactory: () => values.shift(),
    stackName: 'untrusted-stack',
    changeSetName: 'untrusted-change',
    clientToken: 'untrusted-token'
  });
  assert.equal(record.stackName, CONTRACT.stackName);
  assert.notEqual(record.stackName, CONTRACT.blockedStackName);
  assert.equal(record.changeSetName, 'calculadora-varillas-pwa-create-20261016T120000Z-aaaaaaaabbbb');
  assert.equal(record.clientToken, 'calculadora-varillas-pwa-ffffffff-aaaa-4bbb-8ccc-dddddddddddd');
});

test('el skeleton local exige ClientToken y OnStackFailure', () => {
  const skeleton = JSON.parse(readFileSync(join(here, 'fixtures', 'aws-proof', 'create-change-set-cli-v2-skeleton.json'), 'utf8'));
  assert.equal(validateCliSkeleton(skeleton), true);
  delete skeleton.ClientToken;
  assert.throws(() => validateCliSkeleton(skeleton), (error) => error?.code === 'CLI_SKELETON');
});

test('la evidencia se crea 0700/0600 y rechaza reintentos y sobrescritura', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'calculadora-proof-contract-'));
  try {
    chmodSync(temporary, 0o700);
    const attemptsRoot = join(temporary, 'attempts');
    const template = join(temporary, 'template.yaml');
    writeFileSync(template, 'Resources:\n', { mode: 0o600 });
    const baseArguments = [
      cli, 'init-attempt',
      '--attempts-root', attemptsRoot,
      '--template', template,
      '--profile', 'fixture-profile',
      '--region', 'us-east-1',
      '--commit-sha', 'a'.repeat(40),
      '--confirm-commit-sha', 'a'.repeat(40),
      '--confirm-identity-sha', 'b'.repeat(64)
    ];
    const initialized = spawnSync(process.execPath, baseArguments, { encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    const attemptDirectory = initialized.stdout.trim();
    assert.equal(mode(attemptsRoot), 0o700);
    assert.equal(mode(attemptDirectory), 0o700);
    assert.equal(mode(join(attemptDirectory, 'attempt.json')), 0o600);
    assert.equal(mode(join(attemptDirectory, 'submitted-template.yaml')), 0o600);

    const retry = spawnSync(process.execPath, baseArguments, { encoding: 'utf8' });
    assert.notEqual(retry.status, 0);

    const sealed = spawnSync(process.execPath, [
      cli, 'seal', '--attempt-dir', attemptDirectory, '--output-name', 'chain.json'
    ], { encoding: 'utf8' });
    assert.equal(sealed.status, 0, sealed.stderr);
    assert.equal(mode(join(attemptDirectory, 'chain.json')), 0o600);
    const overwrite = spawnSync(process.execPath, [
      cli, 'seal', '--attempt-dir', attemptDirectory, '--output-name', 'chain.json'
    ], { encoding: 'utf8' });
    assert.notEqual(overwrite.status, 0);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('build y validate completan un intento sintético con identidad persistida', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'calculadora-proof-build-'));
  try {
    chmodSync(temporary, 0o700);
    const attemptsRoot = join(temporary, 'attempts');
    const templatePath = join(temporary, 'template.yaml');
    const templateBytes = Buffer.from('Resources:\n', 'ascii');
    writePrivate(templatePath, templateBytes);

    const accountId = ['123456', '789012'].join('');
    const partition = ['a', 'ws'].join('');
    const identity = {
      accountId,
      principalArn: `arn:${partition}:sts::${accountId}:assumed-role/FixtureRole/fixture-session`,
      userId: ['fixture', 'user'].join('-'),
      profile: 'fixture-profile',
      region: 'us-east-1'
    };
    const identityHash = identitySha256(identity);
    const initialized = runCli([
      'init-attempt',
      '--attempts-root', attemptsRoot,
      '--template', templatePath,
      '--profile', identity.profile,
      '--region', identity.region,
      '--commit-sha', 'a'.repeat(40),
      '--confirm-commit-sha', 'a'.repeat(40),
      '--confirm-identity-sha', identityHash
    ]);
    assert.equal(initialized.status, 0, initialized.stderr);
    const attemptDirectory = initialized.stdout.trim();
    const attempt = JSON.parse(readFileSync(join(attemptDirectory, 'attempt.json'), 'utf8'));
    const base = Date.parse(attempt.createdAt);
    const at = (seconds) => utc(base, seconds);
    const rawIdentity = { Account: accountId, Arn: identity.principalArn, UserId: identity.userId };

    writeCapture(attemptDirectory, 'identity', {
      stdout: `${JSON.stringify(rawIdentity)}\n`,
      exitCode: 0,
      requestedAt: at(0),
      respondedAt: at(0)
    });
    const normalized = runCli([
      'normalize-identity',
      '--attempt', join(attemptDirectory, 'attempt.json'),
      '--identity', join(attemptDirectory, 'identity.stdout'),
      '--output', join(attemptDirectory, 'identity.json')
    ]);
    assert.equal(normalized.status, 0, normalized.stderr);
    assert.equal(mode(join(attemptDirectory, 'identity.json')), 0o600);
    writePrivate(join(attemptDirectory, 'commit-template.yaml'), templateBytes);

    const absenceRequestId = 'fixture-describe-request';
    writeCapture(attemptDirectory, 'preflight-describe-stacks', {
      stderr: `DEBUG Response headers: {'x-amzn-requestid': '${absenceRequestId}'}\nAn error occurred (ValidationError) when calling DescribeStacks: stack does not exist\n`,
      exitCode: 254,
      requestedAt: at(1),
      respondedAt: at(2)
    });
    writeCapture(attemptDirectory, 'preflight-list-change-sets', {
      stderr: 'An error occurred (ValidationError) when calling ListChangeSets: stack does not exist\n',
      exitCode: 254,
      requestedAt: at(2),
      respondedAt: at(3)
    });

    const deploymentId = sha256(`${accountId}:${identity.region}:${CONTRACT.stackName}`).slice(0, 10);
    const parameters = [
      { ParameterKey: 'ProjectSlug', ParameterValue: CONTRACT.project },
      { ParameterKey: 'Environment', ParameterValue: CONTRACT.environment },
      { ParameterKey: 'DeploymentId', ParameterValue: deploymentId },
      { ParameterKey: 'PriceClass', ParameterValue: CONTRACT.priceClass }
    ];
    const tags = [
      { Key: 'Project', Value: CONTRACT.project },
      { Key: 'Environment', Value: CONTRACT.environment },
      { Key: 'ManagedBy', Value: 'CloudFormation' },
      { Key: 'Repository', Value: CONTRACT.repository },
      { Key: 'DeploymentId', Value: deploymentId }
    ];
    writePrivateJson(join(attemptDirectory, 'create-request.json'), {
      operation: 'CreateChangeSet',
      requestedAt: at(4),
      profile: identity.profile,
      region: identity.region,
      stackName: CONTRACT.stackName,
      changeSetName: attempt.changeSetName,
      changeSetType: 'CREATE',
      clientToken: attempt.clientToken,
      description: `Calculadora de Varillas template ${sha256(templateBytes)}`,
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
      templateSha256: sha256(templateBytes),
      parameters,
      tags
    });

    const stackId = `fixture-stack/${CONTRACT.stackName}`;
    const changeSetId = `fixture-change/${attempt.changeSetName}`;
    writeCapture(attemptDirectory, 'create-change-set', {
      stdout: `${JSON.stringify({ Id: changeSetId, StackId: stackId })}\n`,
      exitCode: 0,
      requestedAt: at(5),
      respondedAt: at(6)
    });
    writePrivateJson(join(attemptDirectory, 'cloudtrail-describe-event.json'), {
      eventName: 'DescribeStacks',
      eventTime: at(2),
      eventID: 'fixture-absence-event',
      requestID: absenceRequestId,
      awsRegion: identity.region,
      recipientAccountId: accountId,
      userIdentity: { arn: identity.principalArn },
      errorCode: 'ValidationError',
      requestParameters: { stackName: CONTRACT.stackName },
      responseElements: null
    });
    writePrivateJson(join(attemptDirectory, 'cloudtrail-create-event.json'), {
      eventName: 'CreateChangeSet',
      eventTime: at(5),
      eventID: 'fixture-create-event',
      requestID: 'fixture-create-request',
      awsRegion: identity.region,
      recipientAccountId: accountId,
      userIdentity: { arn: identity.principalArn },
      requestParameters: {
        stackName: CONTRACT.stackName,
        changeSetName: attempt.changeSetName,
        clientToken: attempt.clientToken
      },
      responseElements: { id: changeSetId }
    });

    const changes = Object.entries(CONTRACT.logicalResources).map(([LogicalResourceId, ResourceType]) => ({
      Type: 'Resource',
      ResourceChange: {
        Action: 'Add',
        LogicalResourceId,
        ResourceType,
        Replacement: null,
        Scope: [],
        Details: []
      }
    }));
    const snapshots = {
      'describe-change-set': {
        ChangeSetName: attempt.changeSetName,
        ChangeSetId: changeSetId,
        StackName: CONTRACT.stackName,
        StackId: stackId,
        Description: `Calculadora de Varillas template ${sha256(templateBytes)}`,
        Status: 'CREATE_COMPLETE',
        ExecutionStatus: 'AVAILABLE',
        OnStackFailure: 'DO_NOTHING',
        DeploymentConfig: { DisableRollback: false, Mode: 'STANDARD' },
        IncludeNestedStacks: false,
        ImportExistingResources: false,
        Capabilities: [],
        Parameters: parameters,
        Tags: tags,
        Changes: changes
      },
      'list-change-sets': {
        Summaries: [{
          ChangeSetName: attempt.changeSetName,
          ChangeSetId: changeSetId,
          Status: 'CREATE_COMPLETE',
          ExecutionStatus: 'AVAILABLE'
        }]
      },
      'describe-stacks': {
        Stacks: [{
          StackName: CONTRACT.stackName,
          StackId: stackId,
          StackStatus: 'REVIEW_IN_PROGRESS',
          DisableRollback: false,
          Parameters: [],
          Outputs: []
        }]
      },
      'list-stack-resources': { StackResourceSummaries: [] },
      'get-change-template': { TemplateBody: templateBytes.toString('utf8') }
    };
    let captureSecond = 7;
    for (const [name, document] of Object.entries(snapshots)) {
      writeCapture(attemptDirectory, `prepare-${name}`, {
        stdout: `${JSON.stringify(document)}\n`,
        exitCode: 0,
        requestedAt: at(captureSecond),
        respondedAt: at(captureSecond + 1)
      });
      captureSecond += 1;
    }
    writeCapture(attemptDirectory, 'prepare-get-stack-template', {
      stderr: 'An error occurred (ValidationError) when calling GetTemplate\n',
      exitCode: 254,
      requestedAt: at(12),
      respondedAt: at(13)
    });

    const chainPath = join(attemptDirectory, 'chain-input-prepare.json');
    const sealed = runCli([
      'seal', '--attempt-dir', attemptDirectory, '--output-name', 'chain-input-prepare.json'
    ]);
    assert.equal(sealed.status, 0, sealed.stderr);
    const evidencePath = join(attemptDirectory, 'proof-prepare.json');
    const built = runCli([
      'build', '--phase', 'prepare', '--attempt-dir', attemptDirectory,
      '--input-chain', chainPath, '--output', evidencePath
    ]);
    assert.equal(built.status, 0, built.stderr);
    const validated = runCli([
      'validate',
      '--phase', 'prepare',
      '--evidence', evidencePath,
      '--template', templatePath,
      '--commit-template', join(attemptDirectory, 'commit-template.yaml'),
      '--chain', chainPath,
      '--expected-commit-sha', 'a'.repeat(40),
      '--expected-identity-sha', identityHash,
      '--now', at(15)
    ]);
    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /AWS proof: PASS/);
    const proof = JSON.parse(readFileSync(evidencePath, 'utf8'));
    assert.equal(proof.identity.principalArn, identity.principalArn);
    assert.equal(proof.create.response.requestedAt, at(5));

    const prepareReviewedChain = join(attemptDirectory, 'chain-prepare.json');
    const sealedPrepare = runCli([
      'seal', '--attempt-dir', attemptDirectory, '--output-name', 'chain-prepare.json',
      '--previous', chainPath
    ]);
    assert.equal(sealedPrepare.status, 0, sealedPrepare.stderr);

    const pointerPath = join(temporary, '.aws-change-set.json');
    const pointerCreated = runCli([
      'pointer', '--evidence', evidencePath, '--attempt-dir', attemptDirectory, '--output', pointerPath
    ]);
    assert.equal(pointerCreated.status, 0, pointerCreated.stderr);
    const validPointer = JSON.parse(readFileSync(pointerPath, 'utf8'));
    const guardPrepareArguments = (output) => [
      'guard-prepare',
      '--phase', 'prepare',
      '--evidence', evidencePath,
      '--prepare-evidence', evidencePath,
      '--template', templatePath,
      '--commit-template', join(attemptDirectory, 'commit-template.yaml'),
      '--chain', chainPath,
      '--reviewed-chain', prepareReviewedChain,
      '--pointer', pointerPath,
      '--attempt', join(attemptDirectory, 'attempt.json'),
      '--attempt-dir', attemptDirectory,
      '--expected-profile', identity.profile,
      '--expected-region', identity.region,
      '--expected-commit-sha', 'a'.repeat(40),
      '--expected-identity-sha', identityHash,
      '--output', output
    ];

    writePrivateJson(pointerPath, {
      ...validPointer,
      stackId: `fixture-stack/${CONTRACT.blockedStackName}`,
      changeSetId: `fixture-change/${CONTRACT.blockedStackName}`
    });
    const alteredPointer = runCli(guardPrepareArguments(join(attemptDirectory, 'guard-altered-pointer.json')));
    assert.notEqual(alteredPointer.status, 0);
    assert.match(alteredPointer.stderr, /EXECUTE_BINDING/);

    writePrivateJson(join(temporary, 'pointer-target.json'), validPointer);
    rmSync(pointerPath);
    symlinkSync(join(temporary, 'pointer-target.json'), pointerPath);
    const symbolicPointer = runCli(guardPrepareArguments(join(attemptDirectory, 'guard-symbolic-pointer.json')));
    assert.notEqual(symbolicPointer.status, 0);
    assert.match(symbolicPointer.stderr, /PRIVATE_MODE/);
    rmSync(pointerPath);
    writePrivateJson(pointerPath, validPointer);

    const prepareGuardPath = join(attemptDirectory, 'execute-prepare-guard.json');
    const prepareGuard = runCli(guardPrepareArguments(prepareGuardPath));
    assert.equal(prepareGuard.status, 0, prepareGuard.stderr);
    assert.equal(mode(prepareGuardPath), 0o600);
    assert.deepEqual(JSON.parse(readFileSync(prepareGuardPath, 'utf8')).execution, {
      stackId,
      changeSetId,
      changeSetName: attempt.changeSetName,
      clientToken: attempt.clientToken,
      prepareEvidenceSha256: sha256(readFileSync(evidencePath))
    });

    writePrivateJson(join(attemptDirectory, 'toctou-identity.stdout'), rawIdentity);
    captureSecond = 20;
    for (const [name, document] of Object.entries(snapshots)) {
      writeCapture(attemptDirectory, `toctou-${name}`, {
        stdout: `${JSON.stringify(document)}\n`,
        exitCode: 0,
        requestedAt: at(captureSecond),
        respondedAt: at(captureSecond + 1)
      });
      captureSecond += 1;
    }
    writeCapture(attemptDirectory, 'toctou-get-stack-template', {
      stderr: 'An error occurred (ValidationError) when calling GetTemplate\n',
      exitCode: 254,
      requestedAt: at(25),
      respondedAt: at(26)
    });

    const executeInputChain = join(attemptDirectory, 'chain-input-execute.json');
    const sealedExecuteInput = runCli([
      'seal', '--attempt-dir', attemptDirectory, '--output-name', 'chain-input-execute.json',
      '--previous', prepareReviewedChain
    ]);
    assert.equal(sealedExecuteInput.status, 0, sealedExecuteInput.stderr);
    const executeEvidencePath = join(attemptDirectory, 'proof-execute.json');
    const builtExecute = runCli([
      'build', '--phase', 'execute', '--attempt-dir', attemptDirectory,
      '--input-chain', executeInputChain, '--output', executeEvidencePath
    ]);
    assert.equal(builtExecute.status, 0, builtExecute.stderr);
    const executeReviewedChain = join(attemptDirectory, 'chain-execute-reviewed.json');
    const sealedExecute = runCli([
      'seal', '--attempt-dir', attemptDirectory, '--output-name', 'chain-execute-reviewed.json',
      '--previous', executeInputChain
    ]);
    assert.equal(sealedExecute.status, 0, sealedExecute.stderr);

    const guardArguments = (output) => [
      'guard-execute',
      '--phase', 'execute',
      '--evidence', executeEvidencePath,
      '--prepare-evidence', evidencePath,
      '--template', templatePath,
      '--commit-template', join(attemptDirectory, 'commit-template.yaml'),
      '--chain', executeInputChain,
      '--reviewed-chain', executeReviewedChain,
      '--previous-chain', prepareReviewedChain,
      '--pointer', pointerPath,
      '--attempt', join(attemptDirectory, 'attempt.json'),
      '--attempt-dir', attemptDirectory,
      '--expected-profile', identity.profile,
      '--expected-region', identity.region,
      '--expected-commit-sha', 'a'.repeat(40),
      '--expected-identity-sha', identityHash,
      '--output', output
    ];
    const guardExecuteArguments = (output, requestedAt = at(30)) => [
      ...guardArguments(output),
      '--requested-at', requestedAt
    ];
    const clockEnvironment = (name, times) => {
      const hookPath = join(temporary, name);
      writePrivate(hookPath, `
const RealDate = Date;
const times = ${JSON.stringify(times)};
let index = 0;
global.Date = class extends RealDate {
  constructor(...argumentsList) {
    if (argumentsList.length > 0) super(...argumentsList);
    else super(times[Math.min(index++, times.length - 1)]);
  }
  static now() { return new this().getTime(); }
};
`);
      return {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${hookPath}`].filter(Boolean).join(' ')
      };
    };
    const originalExecuteEvidence = readFileSync(executeEvidencePath);
    const changedExecuteEvidence = JSON.parse(originalExecuteEvidence.toString('utf8'));
    changedExecuteEvidence.create.response.stackId = `fixture-stack/${CONTRACT.blockedStackName}`;
    writePrivateJson(executeEvidencePath, changedExecuteEvidence);
    const changedAfterSeal = runCli(guardExecuteArguments(join(attemptDirectory, 'guard-changed-proof.json')));
    assert.notEqual(changedAfterSeal.status, 0);
    assert.match(changedAfterSeal.stderr, /EVIDENCE_CHAIN/);
    writePrivate(executeEvidencePath, originalExecuteEvidence);

    const executeGuardPath = join(attemptDirectory, 'execute-guard.json');
    const executeGuard = runCli(guardExecuteArguments(executeGuardPath));
    assert.equal(executeGuard.status, 0, executeGuard.stderr);
    assert.equal(mode(executeGuardPath), 0o600);
    const guarded = JSON.parse(readFileSync(executeGuardPath, 'utf8'));
    assert.equal(guarded.execution.stackId, stackId);
    assert.equal(guarded.execution.changeSetId, changeSetId);
    assert.equal(guarded.execution.clientToken, attempt.clientToken);
    assert.equal(guarded.reviewedChainSha256, sha256(readFileSync(executeReviewedChain)));

    writePrivateJson(executeEvidencePath, changedExecuteEvidence);
    const changedAtLaunch = spawnSync(process.execPath, [
      cli,
      ...guardArguments(join(attemptDirectory, 'execute-launch-changed-proof.json'))
    ], {
      encoding: 'utf8',
      env: clockEnvironment('clock-changed.cjs', [at(30), at(31)])
    });
    assert.notEqual(changedAtLaunch.status, 0);
    assert.match(changedAtLaunch.stderr, /EVIDENCE_CHAIN/);
    writePrivate(executeEvidencePath, originalExecuteEvidence);

    const launchGuardPath = join(attemptDirectory, 'execute-launch-guard.json');
    const launchGuard = spawnSync(process.execPath, [cli, ...guardArguments(launchGuardPath)], {
      encoding: 'utf8',
      env: clockEnvironment('clock-valid.cjs', [at(30), at(31)])
    });
    assert.equal(launchGuard.status, 0, launchGuard.stderr);
    assert.equal(launchGuard.stdout.trim(), at(31));
    assert.equal(mode(launchGuardPath), 0o600);
    const launchRecord = JSON.parse(readFileSync(launchGuardPath, 'utf8'));
    assert.equal(launchRecord.validationStartedAt, at(30));
    assert.equal(launchRecord.launchAuthorizedAt, at(31));

    const staleGuardPath = join(attemptDirectory, 'execute-launch-stale.json');
    const launchMarker = join(temporary, 'simulated-aws-process-started');
    const delayedLaunch = spawnSync('bash', [
      '-c',
      'set -euo pipefail; validator="$1"; marker="$2"; shift 2; launch_at="$(node "$validator" "$@")"; [[ -n "$launch_at" ]]; printf started >"$marker"',
      'launch-boundary',
      cli,
      launchMarker,
      ...guardArguments(staleGuardPath)
    ], {
      encoding: 'utf8',
      env: clockEnvironment('clock-stale.cjs', [at(30), at(321)])
    });
    assert.notEqual(delayedLaunch.status, 0);
    assert.match(delayedLaunch.stderr, /TIMESTAMP_STALE/);
    assert.throws(() => readFileSync(staleGuardPath), (error) => error?.code === 'ENOENT');
    assert.throws(() => readFileSync(launchMarker), (error) => error?.code === 'ENOENT');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('mide la frescura al terminar el guard antes de crear el proceso AWS', () => {
  const firstTimestamp = script.indexOf('INITIAL_GUARD_AT="$(utc_now)"');
  const firstGuard = script.indexOf('node "$VALIDATOR" guard-execute', firstTimestamp);
  const tokenBinding = script.indexOf('CLIENT_TOKEN="$(jq -er', firstGuard);
  const launchAssignment = script.indexOf('EXECUTE_REQUESTED_AT="$(', tokenBinding);
  const launchGuard = script.indexOf('node "$VALIDATOR" guard-execute', launchAssignment);
  const capture = script.indexOf('capture_command_at execute-change-set "$EXECUTE_REQUESTED_AT"', launchGuard);
  const verify = script.indexOf('node "$VALIDATOR" verify-execute-capture', capture);

  assert.ok(firstTimestamp >= 0 && firstTimestamp < firstGuard);
  assert.ok(firstGuard < tokenBinding && tokenBinding < launchAssignment);
  assert.ok(launchAssignment < launchGuard && launchGuard < capture && capture < verify);
  const launchBlock = script.slice(launchAssignment, capture);
  assert.match(launchBlock, /--output "\$ATTEMPT_DIR\/execute-launch-guard\.json"/);
  assert.doesNotMatch(launchBlock, /--requested-at|\butc_now\b|\bjq\b/);
  assert.match(launchBlock, /^EXECUTE_REQUESTED_AT="\$\([\s\S]+\)"\n$/);
  assert.match(
    script.slice(verify, script.indexOf("require_capture_success 'CloudFormation no aceptó", verify)),
    /--guard "\$ATTEMPT_DIR\/execute-launch-guard\.json"/
  );
});

test('los reportes compartibles admiten únicamente hashes y booleanos', () => {
  const report = buildShareableReport({
    evidenceBytes: Buffer.from('evidence'),
    chainBytes: Buffer.from('chain'),
    proofSummary: {
      absenceCorrelated: true,
      createCorrelated: true,
      fiveAllowedAdds: true,
      fixedTarget: true,
      identityMatched: true,
      templateCanonical: true,
      toctouFresh: true
    },
    templateSha256: sha256('template'),
    commitSha: 'a'.repeat(40),
    identityHash: sha256('identity')
  });
  assert.equal(validateShareableReport(report), true);
  assert.throws(
    () => validateShareableReport({ ...report, leaked: CONTRACT.blockedStackName }),
    (error) => error?.code === 'REPORT_REDACTION'
  );
});

test('los estados privados y el directorio por intento están ignorados', () => {
  const ignored = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.match(ignored, /^\.aws-attempts\/$/m);
  assert.match(ignored, /^\.aws-change-set\.json$/m);
  assert.match(ignored, /^\.aws-deployment\.json$/m);
});
