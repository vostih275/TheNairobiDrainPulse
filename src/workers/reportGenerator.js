const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const MaintenanceTicket = require('../models/MaintenanceTicket');
const WeatherReading = require('../models/WeatherReading');
const Telemetry = require('../models/Telemetry');

const REPORTS_DIR = path.join(__dirname, '../../reports');
const LATEST_REPORT = path.join(REPORTS_DIR, 'drainpulse-report.pdf');
const LOGO_PNG_PATH = path.join(__dirname, '../../public/images/drainpulse-logo.png');

const MARGIN = 50;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return '—';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours} hr${hours === 1 ? '' : 's'} ${minutes} min${minutes === 1 ? '' : 's'}`;
  }
  return `${minutes} min${minutes === 1 ? '' : 's'}`;
}

function averageDuration(durations) {
  if (!durations || durations.length === 0) return 0;
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
}

async function getNetworkHealth() {
  const latestScores = await Telemetry.aggregate([
    { $sort: { nodeId: 1, timestamp: -1 } },
    { $group: { _id: '$nodeId', drainHealthScore: { $first: '$drainHealthScore' } } },
    { $group: { _id: null, avg: { $avg: '$drainHealthScore' } } }
  ]);
  return (latestScores.length > 0 && latestScores[0].avg !== null)
    ? Math.round(latestScores[0].avg)
    : 100;
}

function parseNoteMetric(notes, key) {
  if (!notes) return null;
  const match = notes.match(new RegExp(`${key}=([\\d.]+)`));
  return match ? match[1] : null;
}

async function generateReport() {
  ensureReportsDir();

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const allTickets = await MaintenanceTicket.find({
    status: { $in: ['Pending', 'Dispatched', 'Resolved', 'Closed'] }
  })
    .select('ticketId nodeId locationName severity status diagnosticSummary notes createdAt resolvedAt assignedCrew actionAudit')
    .sort({ createdAt: -1 })
    .lean();

  const resolvedStatuses = ['Resolved', 'Closed'];
  const unresolvedTickets = allTickets.filter(t => !resolvedStatuses.includes(t.status));
  const resolvedTickets = allTickets.filter(t => resolvedStatuses.includes(t.status));

  const criticalStressCount = unresolvedTickets.filter(
    t => t.severity === 'High' || t.severity === 'Critical'
  ).length;
  const pendingRemediationCount = unresolvedTickets.length;

  const resolutionDurations = resolvedTickets
    .filter(t => t.createdAt && t.resolvedAt)
    .map(t => new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime());

  const operationsCompleted = resolvedTickets.length;
  const averageTtrMs = averageDuration(resolutionDurations);
  const averageResolutionTime = operationsCompleted > 0 ? formatDuration(averageTtrMs) : '—';

  const rainfallAgg = await WeatherReading.aggregate([
    { $match: { timestamp: { $gte: sevenDaysAgo } } },
    { $group: { _id: null, avg: { $avg: '$rainfallRateMmHr' } } }
  ]);
  const rawAvgInflow = rainfallAgg.length > 0 ? rainfallAgg[0].avg : 0;
  const cumulativeInflow = Math.max(0, Math.min(250, rawAvgInflow)).toFixed(2);

  const networkHealth = await getNetworkHealth();

  const primaryTicket = unresolvedTickets.find(
    t => t.severity === 'High' || t.severity === 'Critical'
  ) || unresolvedTickets[0] || null;

  let primaryTelemetry = null;
  if (primaryTicket) {
    primaryTelemetry = await Telemetry.findOne({ nodeId: primaryTicket.nodeId })
      .sort({ timestamp: -1 })
      .lean();
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'LETTER' });
    const stream = fs.createWriteStream(LATEST_REPORT);
    doc.pipe(stream);

    // --- Page 1 Header ---
    const logoX = 40;
    const logoY = 40;
    const logoWidth = 120;
    const logoHeight = Math.round(logoWidth * (150 / 650));

    if (fs.existsSync(LOGO_PNG_PATH)) {
      doc.image(LOGO_PNG_PATH, logoX, logoY, { width: logoWidth });
    } else {
      console.warn('[REPORT] Logo PNG not found at', LOGO_PNG_PATH);
    }

    const textX = logoX + logoWidth + 20;
    const textWidth = PAGE_WIDTH - MARGIN - textX;

    // Title
    doc.fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1e3a5f')
      .text('Nairobi City County Water & Sanitation Department', textX, logoY, {
        align: 'left',
        width: textWidth
      });

    // Subtitle
    doc.fontSize(11)
      .font('Helvetica-Oblique')
      .fillColor('#475569')
      .text('Sub-Surface Infrastructure Resilience & Flow Management Audit', textX, doc.y + 10, {
        align: 'left',
        width: textWidth
      });

    // Metadata
    doc.fontSize(9)
      .font('Helvetica')
      .fillColor('#64748b')
      .text(`Operational Scope: 7-Day Network Telemetry & Siltation Audit | Generated: ${formatDate(now)}`, textX, doc.y + 10, {
        align: 'left',
        width: textWidth
      });

    // Divider below header
    const dividerY = Math.max(doc.y + 14, logoY + logoHeight + 20);
    doc.strokeColor('#94a3b8')
      .lineWidth(1)
      .moveTo(MARGIN, dividerY)
      .lineTo(PAGE_WIDTH - MARGIN, dividerY)
      .stroke();
    doc.y = dividerY + 18;

    // --- Executive Summary KPIs ---
    doc.fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1e293b')
      .text('Executive Summary & Key Performance Indicators');

    doc.moveDown(0.6);

    const kpiRows = [
      ['Critical Asset Stress Points', String(criticalStressCount)],
      ['Pending Remediation Actions', String(pendingRemediationCount)],
      ['Operations Completed', String(operationsCompleted)],
      ['Average Resolution Time', averageResolutionTime],
      ['Cumulative Catchment Inflow Index', `${cumulativeInflow} mm/hr`],
      ['Network Operational Health', `${networkHealth}%`]
    ];

    const kpiTop = doc.y;
    const rowHeight = 24;
    const kpiHeight = kpiRows.length * rowHeight + 24;

    doc.fillColor('#f8fafc').rect(MARGIN, kpiTop, CONTENT_WIDTH, kpiHeight).fill();

    let rowY = kpiTop + 12;
    kpiRows.forEach(([label, value], i) => {
      if (i % 2 === 1) {
        doc.fillColor('#f1f5f9').rect(MARGIN, rowY - 6, CONTENT_WIDTH, rowHeight).fill();
      }
      doc.fillColor('#334155')
        .fontSize(10)
        .font('Helvetica-Bold')
        .text(label, MARGIN + 10, rowY, { width: CONTENT_WIDTH * 0.7 });

      doc.fillColor('#0f172a')
        .fontSize(12)
        .font('Helvetica-Bold')
        .text(value, MARGIN + CONTENT_WIDTH * 0.7, rowY, {
          width: CONTENT_WIDTH * 0.3 - 10,
          align: 'right'
        });
      rowY += rowHeight;
    });

    doc.y = rowY + 12;

    // --- Critical Action Item Alert ---
    if (primaryTicket) {
      doc.moveDown(0.5);
      const alertTop = doc.y;
      const alertHeight = 92;

      doc.fillColor('#fef2f2')
        .rect(MARGIN, alertTop, CONTENT_WIDTH, alertHeight)
        .fill();
      doc.strokeColor('#ef4444')
        .lineWidth(1.5)
        .rect(MARGIN, alertTop, CONTENT_WIDTH, alertHeight)
        .stroke();

      doc.fillColor('#b91c1c')
        .fontSize(12)
        .font('Helvetica-Bold')
        .text('CRITICAL ACTION ITEM', MARGIN + 10, alertTop + 10, { width: CONTENT_WIDTH - 20 });

      doc.fillColor('#7f1d1d')
        .fontSize(10)
        .font('Helvetica-Bold')
        .text(`${primaryTicket.locationName} / ${primaryTicket.nodeId}`, MARGIN + 10, alertTop + 30, { width: CONTENT_WIDTH - 20 });

      doc.fillColor('#450a0a')
        .fontSize(9)
        .font('Helvetica')
        .text(`Diagnostic: ${primaryTicket.diagnosticSummary || primaryTicket.notes || 'No notes available'}`, MARGIN + 10, alertTop + 48, { width: CONTENT_WIDTH - 20 });

      const rainRate = parseNoteMetric(primaryTicket.notes, 'rain') || cumulativeInflow;
      const flowSpeed = primaryTelemetry ? primaryTelemetry.flowSpeed : (parseNoteMetric(primaryTicket.notes, 'flow') || '0');
      const flowNote = flowSpeed === 0 || flowSpeed === '0' ? 'Zero-flow reading confirmed' : `Flow speed ${flowSpeed} cm/s`;

      doc.fillColor('#450a0a')
        .fontSize(9)
        .font('Helvetica')
        .text(`Rainfall rate: ${rainRate} mm/hr | ${flowNote} | Siltation flag: ${primaryTelemetry && primaryTelemetry.isBlocked ? 'YES' : 'NO'}`, MARGIN + 10, alertTop + 66, { width: CONTENT_WIDTH - 20 });

      doc.y = alertTop + alertHeight + 12;
    }

    // --- Maintenance Backlog Table ---
    doc.moveDown(0.5);
    doc.fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1e293b')
      .text('Critical Action Items & Maintenance Backlog');

    doc.moveDown(0.5);

    const tableTop = doc.y;
    const diagnosticWidth = Math.round(CONTENT_WIDTH * 0.4);
    const columns = [
      { header: 'Ticket ID', width: 80 },
      { header: 'Location & Node ID', width: CONTENT_WIDTH - 80 - 55 - 65 - diagnosticWidth },
      { header: 'Priority', width: 55 },
      { header: 'Status', width: 65 },
      { header: 'Diagnostic Summary', width: diagnosticWidth }
    ];

    // Header
    doc.fillColor('#1e3a5f').rect(MARGIN, tableTop, CONTENT_WIDTH, 22).fill();
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
    let cx = MARGIN;
    columns.forEach(col => {
      doc.text(col.header, cx + 4, tableTop + 6, { width: col.width - 8 });
      cx += col.width;
    });

    // Rows
    let ty = tableTop + 22;
    const rows = unresolvedTickets.map(t => [
      t.ticketId,
      `${t.locationName}\n${t.nodeId}`,
      t.severity,
      t.status,
      t.diagnosticSummary || 'N/A'
    ]);

    if (rows.length === 0) {
      doc.fillColor('#000000').fontSize(10).font('Helvetica')
        .text('No unresolved maintenance backlog.', MARGIN + 4, ty + 6, { width: CONTENT_WIDTH - 8 });
      ty += 24;
    } else {
      rows.forEach((row, i) => {
        doc.fillColor('#0f172a').fontSize(8).font('Helvetica');
        const rowHeights = row.map((cell, idx) => {
          const col = columns[idx];
          return doc.heightOfString(String(cell), { width: col.width - 8 });
        });
        const rowHeight = Math.max(36, Math.max(...rowHeights) + 10);

        if (ty + rowHeight > PAGE_HEIGHT - MARGIN) {
          doc.addPage();
          ty = MARGIN;
        }

        const fill = i % 2 === 0 ? '#f8fafc' : '#ffffff';
        doc.fillColor(fill).rect(MARGIN, ty, CONTENT_WIDTH, rowHeight).fill();

        doc.fillColor('#0f172a').fontSize(8).font('Helvetica');
        cx = MARGIN;
        row.forEach((cell, idx) => {
          const col = columns[idx];
          doc.text(String(cell), cx + 4, ty + 5, { width: col.width - 8, height: rowHeight - 10, ellipsis: false });
          cx += col.width;
        });
        ty += rowHeight;
      });
    }

    // Table border
    doc.strokeColor('#94a3b8')
      .lineWidth(0.5)
      .rect(MARGIN, tableTop, CONTENT_WIDTH, ty - tableTop)
      .stroke();

    // Position cursor below the table before the next section
    doc.y = ty + 14;

    // --- Completed Operations & Accountability Trail ---
    const resolvedRows = resolvedTickets.map(t => {
      const ttr = t.createdAt && t.resolvedAt
        ? new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()
        : null;
      return [
        `${t.ticketId}\n${t.locationName}`,
        t.assignedCrew || '—',
        t.actionAudit?.resolvedByMemberName || '—',
        formatDuration(ttr)
      ];
    });

    const completedHeading = 'Completed Operations & Accountability Trail';
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e293b');
    const completedHeadingHeight = doc.heightOfString(completedHeading, { width: CONTENT_WIDTH });
    doc.fontSize(9).font('Helvetica').fillColor('#0f172a');
    const completedRowHeight = 36;
    const completedTableHeight = completedHeadingHeight + 8 + 22 + (resolvedRows.length > 0 ? resolvedRows.length * completedRowHeight : completedRowHeight) + 10;

    if (doc.y + completedTableHeight > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
    } else {
      doc.moveDown(0.5);
    }

    doc.fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1e293b')
      .text(completedHeading);

    doc.moveDown(0.5);

    const completedTableTop = doc.y;
    const completedColumns = [
      { header: 'Ticket ID & Location', width: 140 },
      { header: 'Dispatched Asset', width: 120 },
      { header: 'Verified Operator', width: 120 },
      { header: 'Time to Resolve', width: CONTENT_WIDTH - 140 - 120 - 120 }
    ];

    doc.fillColor('#1e3a5f').rect(MARGIN, completedTableTop, CONTENT_WIDTH, 22).fill();
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
    let cColX = MARGIN;
    completedColumns.forEach(col => {
      doc.text(col.header, cColX + 4, completedTableTop + 6, { width: col.width - 8 });
      cColX += col.width;
    });

    let rty = completedTableTop + 22;
    if (resolvedRows.length === 0) {
      doc.fillColor('#000000').fontSize(10).font('Helvetica')
        .text('No completed operations recorded.', MARGIN + 4, rty + 6, { width: CONTENT_WIDTH - 8 });
      rty += completedRowHeight;
    } else {
      resolvedRows.forEach((row, i) => {
        if (rty > PAGE_HEIGHT - MARGIN - 40) {
          doc.addPage();
          rty = MARGIN;
        }
        const fill = i % 2 === 0 ? '#f8fafc' : '#ffffff';
        doc.fillColor(fill).rect(MARGIN, rty, CONTENT_WIDTH, completedRowHeight).fill();

        doc.fillColor('#0f172a').fontSize(8).font('Helvetica');
        cColX = MARGIN;
        row.forEach((cell, idx) => {
          const col = completedColumns[idx];
          doc.text(String(cell), cColX + 4, rty + 5, { width: col.width - 8, height: completedRowHeight - 10, ellipsis: true });
          cColX += col.width;
        });
        rty += completedRowHeight;
      });
    }

    doc.strokeColor('#94a3b8')
      .lineWidth(0.5)
      .rect(MARGIN, completedTableTop, CONTENT_WIDTH, rty - completedTableTop)
      .stroke();

    doc.y = rty + 14;

    // --- Recommendations ---
    const recommendations = [];
    if (primaryTicket) {
      recommendations.push(`Dispatch a remediation crew immediately to ${primaryTicket.locationName} (${primaryTicket.nodeId}) to assess desilting requirements.`);
    }
    if (criticalStressCount > 0) {
      recommendations.push(`Prioritise all ${criticalStressCount} high/critical asset stress point(s) for sediment removal and flow restoration within 24 hours.`);
    }
    if (pendingRemediationCount > 0) {
      recommendations.push(`Resolve ${pendingRemediationCount} pending remediation action(s) and update ticket statuses to Resolved once verified in the field.`);
    }
    recommendations.push(`Allocate desilting budget and vacuum-truck resources proportional to the cumulative catchment inflow index of ${cumulativeInflow} mm/hr.`);
    recommendations.push(`Schedule a follow-up telemetry and siltation audit in 7 days to validate infrastructure resilience improvements.`);
    if (networkHealth < 70) {
      recommendations.push(`Escalate network health score (${networkHealth}%) to the Water Operations control room for immediate intervention.`);
    }

    // Reserve enough vertical space to keep the heading with the entire list
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e293b');
    const headingHeight = doc.heightOfString('Sign-Off & Operational Recommendations', { width: CONTENT_WIDTH });
    const itemGap = 4;
    doc.fontSize(10).font('Helvetica').fillColor('#334155');
    const listHeight = recommendations.reduce((sum, rec) => {
      return sum + doc.heightOfString(rec, { width: CONTENT_WIDTH - 18 }) + itemGap;
    }, 0);
    const sectionHeight = headingHeight + 8 + listHeight + 10;

    if (doc.y + sectionHeight > PAGE_HEIGHT - MARGIN) {
      doc.addPage();
    } else {
      doc.moveDown(1);
    }

    const sectionTop = doc.y;
    doc.fontSize(14)
      .font('Helvetica-Bold')
      .fillColor('#1e293b')
      .text('Sign-Off & Operational Recommendations', MARGIN, sectionTop, { width: CONTENT_WIDTH });

    doc.y = sectionTop + headingHeight + 8;

    doc.fontSize(10).font('Helvetica').fillColor('#334155');
    recommendations.forEach((rec, i) => {
      const itemHeight = doc.heightOfString(rec, { width: CONTENT_WIDTH - 18 }) + 10;
      if (doc.y + itemHeight > PAGE_HEIGHT - MARGIN) {
        doc.addPage();
      }
      const y = doc.y;
      doc.fillColor('#1e3a5f').font('Helvetica-Bold').text(`${i + 1}.`, MARGIN, y, { width: 18, lineBreak: false });
      doc.fillColor('#334155').font('Helvetica').text(rec, MARGIN + 18, y, { width: CONTENT_WIDTH - 18 });
      doc.moveDown(0.3);
    });

    doc.end();

    stream.on('finish', () => resolve(LATEST_REPORT));
    stream.on('error', reject);
  });
}

module.exports = { generateReport, LATEST_REPORT };
