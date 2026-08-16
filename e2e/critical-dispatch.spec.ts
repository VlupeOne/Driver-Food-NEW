import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const PASSWORD = 'Demo@123';

async function logIn(
  page: Page,
  email: string,
  destination: 'entregador' | 'operacao',
): Promise<void> {
  await page.goto('/#/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);

  const loginResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/auth/login';
  });

  await page.getByRole('button', { name: 'Entrar no painel', exact: true }).click();

  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok()).toBeTruthy();
  await expect(page).toHaveURL(new RegExp('#/' + destination + '$'));
}

test('motoboy elegivel recebe e aceita a rota planejada pelo operador', async ({
  browser,
}) => {
  let courierContext: BrowserContext | undefined;
  let operatorContext: BrowserContext | undefined;

  try {
    courierContext = await browser.newContext();
    const courierPage = await courierContext.newPage();

    const heartbeatResponsePromise = courierPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        url.pathname === '/api/courier/heartbeat'
      );
    });

    await logIn(courierPage, 'rafael@bellamassa.demo', 'entregador');

    const heartbeatResponse = await heartbeatResponsePromise;
    expect(heartbeatResponse.ok()).toBeTruthy();

    operatorContext = await browser.newContext();
    const operatorPage = await operatorContext.newPage();
    await logIn(operatorPage, 'operador@bellamassa.demo', 'operacao');

    const planResponsePromise = operatorPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        url.pathname === '/api/dispatch/plan'
      );
    });

    await operatorPage
      .getByRole('button', { name: 'Planejar rotas', exact: true })
      .first()
      .click();

    const planResponse = await planResponsePromise;
    expect(planResponse.ok()).toBeTruthy();

    const planPayload = (await planResponse.json()) as {
      data?: { routes?: unknown[] };
    };
    expect(planPayload.data?.routes?.length).toBeGreaterThan(0);

    await expect(
      courierPage.getByText('Nova rota dispon\u00edvel', { exact: true }),
    ).toBeVisible();

    const routeHeading = courierPage.getByRole('heading', {
      name: /^Rota RT-\d+$/,
    });
    const offeredRouteCode = await routeHeading.textContent();
    expect(offeredRouteCode).toMatch(/^Rota RT-\d+$/);

    const acceptResponsePromise = courierPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        /^\/api\/courier\/routes\/[^/]+\/accept$/.test(url.pathname)
      );
    });

    await courierPage
      .getByRole('button', { name: 'Aceitar rota', exact: true })
      .click();

    const acceptResponse = await acceptResponsePromise;
    expect(acceptResponse.ok()).toBeTruthy();

    await expect(
      courierPage.getByText('Nova rota dispon\u00edvel', { exact: true }),
    ).toBeHidden();
    await expect(
      courierPage.getByRole('heading', { name: offeredRouteCode ?? '' }),
    ).toBeVisible();
  } finally {
    await operatorContext?.close();
    await courierContext?.close();
  }
});
