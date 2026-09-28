import {expect} from '@playwright/test';
import {test} from './workerContext';
import {openStory, preparePopupSandbox} from './popupSandbox.helpers';
import {moveClient, trackBrowserErrors} from './accessibility.helpers';

test('client Picture-in-Picture collapses desktop columns into one full-window chat column', async({page}) => {
  await preparePopupSandbox(page);
  expect(await moveClient(page, true)).toBe(true);

  await page.locator('#a11y-other-window').evaluate((frame: HTMLIFrameElement) => {
    frame.style.width = '1100px';
    frame.style.height = '1000px';
  });

  const frame = page.frameLocator('#a11y-other-window');
  const layout = await frame.locator('#page-chats').evaluate((root) => {
    const style = (element: Element) => {
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        display: computed.display,
        gridTemplateColumns: computed.gridTemplateColumns,
        flex: computed.flex,
        position: computed.position
      };
    };
    const page = root as HTMLElement;
    const columns = page.querySelector('#main-columns') as HTMLElement;
    const left = page.querySelector('#column-left') as HTMLElement;
    const center = page.querySelector('#column-center') as HTMLElement;
    const right = page.querySelector('#column-right') as HTMLElement;
    const ancestors = [page, page.parentElement, page.ownerDocument.documentElement]
    .filter((element): element is HTMLElement => !!element)
    .map((element) => ({id: element.id || element.tagName.toLowerCase(), ...style(element)}));
    return {
      page: style(page),
      columns: style(columns),
      left: style(left),
      center: style(center),
      right: style(right),
      ancestors
    };
  });

  expect(layout.page.width).toBe(1100);
  expect(layout.page.height).toBe(1000);
  expect(layout.page.display).toBe('grid');
  expect(layout.page.gridTemplateColumns).toBe(`${layout.page.width}px`);
  expect(layout.columns.display).toBe('grid');
  expect(layout.columns.gridTemplateColumns).toBe(`${layout.columns.width}px`);
  expect(layout.left.display).toBe('none');
  expect(layout.right.display).toBe('none');
  expect(layout.center.width).toBeCloseTo(layout.columns.width);
  expect(layout.ancestors.map(({id}) => id)).toEqual(['page-chats', 'body', 'html']);

  await moveClient(page, false);
});

test('an open dialog keeps its focus scope when the client moves to another document and back', async({page}) => {
  const errors = trackBrowserErrors(page);
  await preparePopupSandbox(page);
  expect(await openStory(page, 'confirmation/generic')).toBeNull();
  const cancel = page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true});
  await cancel.focus();
  expect(await moveClient(page, true)).toBe(true);
  const inFrame = page.frameLocator('#a11y-other-window');
  const dialog = inFrame.getByRole('dialog');
  await expect(dialog.getByRole('button', {name: 'Cancel', exact: true})).toBeFocused();
  const controls = dialog.getByRole('button');
  await controls.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();

  await moveClient(page, false);
  const restored = page.getByRole('dialog');
  await expect(restored.getByRole('button').last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(restored.getByRole('button').first()).toBeFocused();
  await restored.getByRole('button', {name: 'Cancel', exact: true}).press('Enter');
  await expect(restored).toHaveCount(0);
  expect(errors).toEqual({pageErrors: [], renderErrors: []});
});

test('a menu closes on a window move while its parent dialog remains keyboard-operable', async({page}) => {
  const errors = trackBrowserErrors(page);
  await preparePopupSandbox(page);
  expect(await openStory(page, 'rtmp/start')).toBeNull();
  expect(await moveClient(page, true)).toBe(true);
  const inFrame = page.frameLocator('#a11y-other-window');
  await inFrame.getByRole('dialog').getByRole('button', {name: 'More', exact: true}).press('Enter');
  await expect(inFrame.getByRole('menu')).toBeVisible();
  await moveClient(page, false);
  await expect(page.getByRole('menu')).toHaveCount(0);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Close', exact: true}).press('Enter');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual({pageErrors: [], renderErrors: []});
});

test('a dialog created in the other window can close after returning to the tab', async({page}) => {
  const errors = trackBrowserErrors(page);
  await preparePopupSandbox(page);
  expect(await moveClient(page, true)).toBe(true);
  const frame = page.frameLocator('#a11y-other-window');
  const triggerName = 'confirmationPopup() confirmation/generic';
  await frame.getByRole('button', {name: triggerName, exact: true}).press('Enter');
  const dialog = frame.getByRole('dialog');
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).focus();
  await moveClient(page, false);
  await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', {name: triggerName, exact: true})).toBeFocused();
  expect(errors).toEqual({pageErrors: [], renderErrors: []});
});
