import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { execFile } from 'node:child_process';
import express from 'express';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const projectRoot = process.cwd();
const extractorScriptPath = resolve(projectRoot, 'tools/extract-equipment-builder.mjs');
const outputJsonPath = resolve(projectRoot, 'src/app/equipment-builder/data/equipment-builder-data.json');
const cddExtractorScriptPath = resolve(projectRoot, 'tools/extract-cdd-excel.mjs');
const cddOutputJsonPath = resolve(projectRoot, 'src/app/equipment-builder/data/cdd-sequence-catalog.json');
const cddReportJsonPath = resolve(projectRoot, 'src/app/equipment-builder/data/cdd-sequence-catalog.report.json');
const combinedOutputJsonPath = resolve(projectRoot, 'src/app/equipment-builder/data/seq-parameter-cdd.json');
const execFileAsync = promisify(execFile);

const app = express();
const angularApp = new AngularNodeAppEngine();

app.post('/api/extract-equipment-builder', express.raw({ type: 'application/octet-stream', limit: '40mb' }), async (req, res) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).send('Request body must be an Excel file binary.');
      return;
    }

    const fileNameHeader = req.header('x-file-name') ?? 'equipment-builder.xlsx';
    const safeFileName = fileNameHeader.replace(/[^A-Za-z0-9._-]/g, '_');
    const tempFilePath = resolve(tmpdir(), `${Date.now()}-${safeFileName}`);

    await fs.writeFile(tempFilePath, body);
    await fs.mkdir(resolve(projectRoot, 'src/app/equipment-builder/data'), { recursive: true });

    try {
      await execFileAsync(process.execPath, [
        extractorScriptPath,
        '--input',
        tempFilePath,
        '--output',
        outputJsonPath,
      ], {
        cwd: projectRoot,
      });
    } finally {
      await fs.rm(tempFilePath, { force: true });
    }

    let items = 0;
    try {
      const jsonText = await fs.readFile(outputJsonPath, 'utf-8');
      const parsed = JSON.parse(jsonText) as unknown;
      if (Array.isArray(parsed)) items = parsed.length;
    } catch {
      items = 0;
    }

    res.json({
      ok: true,
      outputPath: 'src/app/equipment-builder/data/equipment-builder-data.json',
      items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extraction failed.';
    res.status(500).send(message);
  }
});

app.post('/api/extract-cdd', express.raw({ type: 'application/octet-stream', limit: '40mb' }), async (req, res) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).send('Request body must be an Excel file binary.');
      return;
    }

    const fileNameHeader = req.header('x-file-name') ?? 'cdd-source.xlsx';
    const safeFileName = fileNameHeader.replace(/[^A-Za-z0-9._-]/g, '_');
    const tempFilePath = resolve(tmpdir(), `${Date.now()}-${safeFileName}`);

    await fs.writeFile(tempFilePath, body);
    await fs.mkdir(resolve(projectRoot, 'src/app/equipment-builder/data'), { recursive: true });

    try {
      await execFileAsync(process.execPath, [
        cddExtractorScriptPath,
        '--input',
        tempFilePath,
        '--output',
        cddOutputJsonPath,
        '--report',
        cddReportJsonPath,
      ], {
        cwd: projectRoot,
      });
    } finally {
      await fs.rm(tempFilePath, { force: true });
    }

    let sequenceCount = 0;
    let scenarioCount = 0;
    try {
      const reportText = await fs.readFile(cddReportJsonPath, 'utf-8');
      const report = JSON.parse(reportText) as { sequenceCount?: number; scenarioCount?: number };
      if (typeof report.sequenceCount === 'number') sequenceCount = report.sequenceCount;
      if (typeof report.scenarioCount === 'number') scenarioCount = report.scenarioCount;
    } catch {
      sequenceCount = 0;
      scenarioCount = 0;
    }

    res.json({
      ok: true,
      outputPath: 'src/app/equipment-builder/data/cdd-sequence-catalog.json',
      reportPath: 'src/app/equipment-builder/data/cdd-sequence-catalog.report.json',
      sequenceCount,
      scenarioCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CDD extraction failed.';
    res.status(500).send(message);
  }
});

app.post('/api/extract-all-data', express.raw({ type: 'application/octet-stream', limit: '40mb' }), async (req, res) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).send('Request body must be an Excel file binary.');
      return;
    }

    const fileNameHeader = req.header('x-file-name') ?? 'equipment-source.xlsx';
    const safeFileName = fileNameHeader.replace(/[^A-Za-z0-9._-]/g, '_');
    const tempFilePath = resolve(tmpdir(), `${Date.now()}-${safeFileName}`);
    const tempEquipmentOutputPath = resolve(tmpdir(), `${Date.now()}-${safeFileName}.equipment-builder-data.json`);

    await fs.writeFile(tempFilePath, body);
    await fs.mkdir(resolve(projectRoot, 'src/app/equipment-builder/data'), { recursive: true });

    try {
      await execFileAsync(process.execPath, [
        extractorScriptPath,
        '--input',
        tempFilePath,
        '--output',
        tempEquipmentOutputPath,
      ], {
        cwd: projectRoot,
      });

      await execFileAsync(process.execPath, [
        cddExtractorScriptPath,
        '--input',
        tempFilePath,
        '--output',
        cddOutputJsonPath,
        '--report',
        cddReportJsonPath,
      ], {
        cwd: projectRoot,
      });
    } finally {
      await fs.rm(tempFilePath, { force: true });
    }

    let equipmentItems = 0;
    let sequenceParameterData: unknown[] = [];
    try {
      const jsonText = await fs.readFile(tempEquipmentOutputPath, 'utf-8');
      const parsed = JSON.parse(jsonText) as unknown;
      if (Array.isArray(parsed)) {
        sequenceParameterData = parsed;
        equipmentItems = parsed.length;
      }
    } catch {
      equipmentItems = 0;
      sequenceParameterData = [];
    }

    await fs.rm(tempEquipmentOutputPath, { force: true });

    let cddSequenceCount = 0;
    let cddScenarioCount = 0;
    let cddCatalog: {
      generatedAt?: string;
      sourceWorkbooks?: string[];
      sequences?: Array<Record<string, unknown>>;
    } = {};
    try {
      const catalogText = await fs.readFile(cddOutputJsonPath, 'utf-8');
      cddCatalog = JSON.parse(catalogText) as {
        generatedAt?: string;
        sourceWorkbooks?: string[];
        sequences?: Array<Record<string, unknown>>;
      };

      const reportText = await fs.readFile(cddReportJsonPath, 'utf-8');
      const report = JSON.parse(reportText) as { sequenceCount?: number; scenarioCount?: number };
      if (typeof report.sequenceCount === 'number') cddSequenceCount = report.sequenceCount;
      if (typeof report.scenarioCount === 'number') cddScenarioCount = report.scenarioCount;
    } catch {
      cddSequenceCount = 0;
      cddScenarioCount = 0;
      cddCatalog = {};
    }

    const combinedCatalog = {
      ...cddCatalog,
      sequenceParameterData,
    };
    await fs.writeFile(combinedOutputJsonPath, `${JSON.stringify(combinedCatalog, null, 2)}\n`, 'utf-8');

    res.json({
      ok: true,
      cddOutputPath: 'src/app/equipment-builder/data/cdd-sequence-catalog.json',
      cddReportPath: 'src/app/equipment-builder/data/cdd-sequence-catalog.report.json',
      combinedOutputPath: 'src/app/equipment-builder/data/seq-parameter-cdd.json',
      equipmentItems,
      cddSequenceCount,
      cddScenarioCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Combined extraction failed.';
    res.status(500).send(message);
  }
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/**', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
