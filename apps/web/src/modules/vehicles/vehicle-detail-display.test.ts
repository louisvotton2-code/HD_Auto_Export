import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makePublicVehicleFixture, makePublicationPreviewFixture } from '@hd/contracts/fixtures';
import { PublicVehicleInlineSchema, type DisplayText, type PublicVehicleInline } from '@hd/contracts/public';
import { PublicationPreviewSchema } from '@hd/contracts/admin';
import { publicVehicleMessages } from './public-messages';
import { publicVehicleFacts } from './public-presentation';
import { PublicationPreviewDetail } from './ui/publication-preview-detail';
import { PublicVehicleConfiguration } from './ui/public-vehicle-configuration';

function configurationIds(html: string) {
  return [...html.matchAll(/data-configuration-item="([^"]+)"/g)].map((match) => match[1]);
}

describe('staff preview and public vehicle detail', () => {
  it.each(['zh', 'en', 'ru'] as const)('preserves factual zero and removes only duplicate configuration in %s', (locale) => {
    const preview = makePublicationPreviewFixture(locale);
    const facts = {
      ...preview.vehicle.facts,
      mileageKm: 0, engineCc: 0, powerHp: null, powerKw: null, powertrain: 'unknown' as const,
      body: null, transmission: null, location: null,
    };
    const text = (value: string): DisplayText => ({
      status: 'ready', text: value, requestedLocale: locale,
      contentLocale: 'en', provenance: 'human', reviewed: true,
    });
    const displacementId = 'cfg-639291cf';
    const vehicleClass = text('Compact car');
    const technicalDetails = {
      power: { engineKw: 120, engineHp: 0, systemKw: 150 },
      configurationMatches: [{ id: displacementId, semanticKey: 'displacementCc' as const, source: 'record' as const }],
    };
    const configurationInline: PublicVehicleInline['configurationInline'] = [
      { id: displacementId, semanticKey: 'displacementCc', name: text('Displacement (cc)'), value: text('0 cc') },
      { id: 'cfg-a8112d0f', semanticKey: 'displacementCc', name: text('Displacement (cc)'), value: text('1998 cc') },
      { id: 'cfg-b18b0120', semanticKey: 'engineKw', name: text('Engine power (kW)'), value: text('120 kW') },
      { id: 'cfg-d1bba150', semanticKey: 'motorKw', name: text('Motor power (kW)'), value: text('150 kW') },
    ];
    preview.vehicle.facts = facts;
    preview.vehicle.vehicleClass = vehicleClass;
    preview.vehicle.technicalDetails = technicalDetails;
    preview.vehicle.configuration = {
      version: 1, items: configurationInline.map(({ semanticKey: _semanticKey, ...item }) => item),
    };
    const vehicle: PublicVehicleInline = {
      ...makePublicVehicleFixture(), facts, vehicleClass, technicalDetails,
      projection: 'detail-inline-v1', configurationInline,
      inspectionSummary: { status: 'no_report', contentLocale: null, checked: null, faults: null, categories: [] },
      inspectionInline: { conclusions: [], defects: [], normalItemCount: 0, hasMoreConclusions: false, hasMoreDefects: false },
    };
    const staff = renderToStaticMarkup(createElement(PublicationPreviewDetail, {
      preview: PublicationPreviewSchema.parse(preview),
    }));
    const publicConfig = renderToStaticMarkup(createElement(PublicVehicleConfiguration, {
      vehicle: PublicVehicleInlineSchema.parse(vehicle), locale,
    }));
    const copy = publicVehicleMessages(locale);
    expect(staff).toMatch(new RegExp(`<dt>${copy.mileageLabel}</dt><dd><span[^>]*>0 ${copy.km}</span>`));
    expect(staff).toMatch(new RegExp(`<dt>${copy.engineLabel}</dt><dd><span[^>]*>0 cm³</span>`));
    expect(staff).not.toContain('data-vehicle-fact="powerHp"');
    for (const unknown of [copy.powertrain, copy.bodyLabel, copy.transmissionLabel, copy.locationLabel]) {
      expect(staff).not.toContain(`<dt>${unknown}</dt>`);
    }
    const units = { zh: { hp: '马力', kw: 'kW' }, en: { hp: 'hp', kw: 'kW' }, ru: { hp: 'л. с.', kw: 'кВт' } }[locale];
    const shownValues = [...staff.matchAll(/<dt>[^<]*<\/dt><dd><span[^>]*>([^<]*)<\/span>/g)].map((match) => match[1]);
    const technicalValues = ['Compact car', `0 ${units.hp}`, `120 ${units.kw}`, `150 ${units.kw}`];
    const publicFacts = publicVehicleFacts(vehicle, locale);
    expect(shownValues).toEqual(expect.arrayContaining(technicalValues));
    expect(publicFacts.map((row) => row.value)).toEqual(expect.arrayContaining(technicalValues));
    expect(publicFacts.find((row) => row.id === 'vehicleClass'))
      .toMatchObject({ value: 'Compact car', lang: 'en' });
    for (const html of [staff, publicConfig]) {
      expect(configurationIds(html)).toEqual(configurationInline.slice(1, 3).map((item) => item.id));
      expect(html).toContain('1998 cc');
      expect(html).toContain('120 kW');
    }
    expect(publicFacts.find((row) => row.id === 'motorKw')?.configuration?.itemIds)
      .toEqual([configurationInline[3]!.id]);
    expect(staff).toContain('data-vehicle-fact="motorKw"');
    delete preview.vehicle.technicalDetails;
    delete vehicle.technicalDetails;
    expect(configurationIds(renderToStaticMarkup(createElement(PublicationPreviewDetail, { preview }))))
      .toEqual(configurationInline.slice(0, 2).map((item) => item.id));
    expect(configurationIds(renderToStaticMarkup(createElement(PublicVehicleConfiguration, { vehicle, locale }))))
      .toEqual(configurationInline.slice(0, 2).map((item) => item.id));
  });
});
