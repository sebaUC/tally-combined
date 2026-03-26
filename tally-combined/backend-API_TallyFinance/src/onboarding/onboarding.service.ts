import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { DataParserService } from '../common/utils/data-parser.service';
import { OnboardingDto, OnboardingAnswers } from './dto/onboarding.dto';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly parser: DataParserService,
  ) {}

  async processOnboarding(userId: string, dto: OnboardingDto) {
    const answers = dto.answers;
    const now = new Date().toISOString();
    this.logger.log(`[onboarding] Iniciando flujo para usuario ${userId}`);
    this.logger.debug(`[onboarding] Payload completo ${JSON.stringify(dto)}`);

    await this.upsertUserPrefs(userId, answers, now);
    await this.upsertPersonalitySnapshot(userId, answers, now);
    await this.syncSpendingExpectations(userId, answers, now);
    await this.syncIncomeExpectations(userId, answers, now);
    const accountIds = await this.syncAccounts(userId, answers, now);
    await this.syncPaymentMethods(userId, answers, now, accountIds);
    await this.syncCategories(userId, answers, now);
    await this.syncGoals(userId, answers, now);
    await this.markOnboardingCompleted(userId, now);

    this.logger.log(
      `[onboarding] Datos completos almacenados para usuario ${userId}`,
    );
  }

  private async markOnboardingCompleted(userId: string, now: string) {
    const { error: updateError } = await this.supabase
      .from('users')
      .update({ onboarding_completed: true, updated_at: now })
      .eq('id', userId);

    if (updateError) {
      this.logger.error(
        `[onboarding] Failed to flag completion: ${updateError.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo actualizar el estado de onboarding.',
      );
    }
  }

  private async upsertUserPrefs(
    userId: string,
    answers: OnboardingAnswers,
    now: string,
  ) {
    const level = answers.notifications ?? 'none';
    const unifiedBalance = answers.unifiedBalance ?? true;
    this.logger.log(
      `[onboarding] Actualizando user_prefs para ${userId} unifiedBalance=${unifiedBalance}`,
    );

    const { error } = await this.supabase.from('user_prefs').upsert(
      {
        id: userId,
        unified_balance: unifiedBalance,
        notification_level: level,
        updated_at: now,
      },
      { onConflict: 'id' },
    );

    if (error) {
      this.logger.error(
        `[onboarding] No se pudo actualizar user_prefs: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudieron guardar las preferencias del usuario.',
      );
    }
  }

  private async upsertPersonalitySnapshot(
    userId: string,
    answers: OnboardingAnswers,
    now: string,
  ) {
    if (!answers.personality) {
      this.logger.warn(
        `[onboarding] personality no presente, se omite snapshot para ${userId}`,
      );
      return;
    }

    const payload = {
      user_id: userId,
      tone: answers.personality.tone,
      intensity: answers.personality.intensity,
      mood: 'normal',
      updated_at: now,
      mood_updated_at: now,
    };

    const { error } = await this.supabase
      .from('personality_snapshot')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      this.logger.error(
        `[onboarding] No se pudo actualizar personality_snapshot: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo guardar el perfil del bot.',
      );
    }
  }

  private async syncSpendingExpectations(
    userId: string,
    answers: OnboardingAnswers,
    now: string,
  ) {
    if (!answers.spendingExpectations) {
      this.logger.warn(
        `[onboarding] spendingExpectations no presente, se omite para ${userId}`,
      );
      return;
    }

    const entries = [
      { period: 'daily', entry: answers.spendingExpectations.daily },
      { period: 'weekly', entry: answers.spendingExpectations.weekly },
      { period: 'monthly', entry: answers.spendingExpectations.monthly },
    ] as const;

    const { error: deleteError } = await this.supabase
      .from('spending_expectations')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      this.logger.error(
        `[onboarding] No se pudieron limpiar spending_expectations: ${deleteError.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo preparar las expectativas de gasto previas.',
      );
    }

    const records = entries.map(({ period, entry }) => ({
      id: randomUUID(),
      user_id: userId,
      period,
      active: entry?.active ?? false,
      amount: this.parser.parseAmount(entry?.amount),
      created_at: now,
      updated_at: now,
    }));

    const { error } = await this.supabase
      .from('spending_expectations')
      .insert(records);

    if (error) {
      this.logger.error(
        `[onboarding] No se pudieron guardar spending_expectations: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudieron guardar las expectativas de gasto.',
      );
    }
  }

  private async syncIncomeExpectations(
    userId: string,
    answers: OnboardingAnswers,
    now: string,
  ) {
    // Clean existing income expectations
    const { error: deleteError } = await this.supabase
      .from('income_expectations')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      this.logger.error(
        `[onboarding] No se pudieron limpiar income_expectations: ${deleteError.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudieron preparar las expectativas de ingreso previas.',
      );
    }

    // If user marked "no income" or no data, skip
    if (answers.noIncome || !answers.incomeExpectations) {
      this.logger.log(
        `[onboarding] noIncome=${answers.noIncome}, se omite income_expectations para ${userId}`,
      );
      return;
    }

    const periods = ['monthly', 'weekly', 'daily'] as const;
    const records: Array<Record<string, any>> = [];

    for (const period of periods) {
      const entry = answers.incomeExpectations[period];
      if (!entry?.active) continue;

      const amount = this.parser.parseAmount(entry.amount);
      if (!amount || amount <= 0) continue;

      records.push({
        id: randomUUID(),
        user_id: userId,
        period,
        amount,
        pay_day: entry.payDay?.trim() || null,
        active: true,
        created_at: now,
        updated_at: now,
      });
    }

    if (!records.length) {
      this.logger.log('[onboarding] No hay ingresos activos para guardar.');
      return;
    }

    const { error } = await this.supabase
      .from('income_expectations')
      .insert(records);

    if (error) {
      this.logger.error(
        `[onboarding] No se pudieron guardar income_expectations: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudieron guardar las expectativas de ingreso.',
      );
    }

    this.logger.log(
      `[onboarding] ${records.length} income_expectations guardadas para ${userId}`,
    );
  }

  private async syncAccounts(
    userId: string,
    answers: OnboardingAnswers,
    _now: string,
  ): Promise<string[]> {
    const paymentMethods = answers.payment_method ?? [];
    const unifiedBalance = answers.unifiedBalance ?? true;

    this.logger.log(
      `[onboarding] Sincronizando accounts para ${userId} unifiedBalance=${unifiedBalance}`,
    );

    // Clean existing accounts
    await this.supabase.from('accounts').delete().eq('user_id', userId);

    const initialBalance = Number(answers.initialBalance) || 0;

    if (unifiedBalance || !paymentMethods.length) {
      // Create a single unified account
      const accountId = randomUUID();
      const { error } = await this.supabase.from('accounts').insert({
        id: accountId,
        user_id: userId,
        name: 'Cuenta Principal',
        institution: null,
        currency: 'CLP',
        current_balance: initialBalance,
      });

      if (error) {
        this.logger.error(
          `[onboarding] No se pudo crear account unificada: ${error.message}`,
        );
        throw new InternalServerErrorException(
          'No se pudo crear la cuenta.',
        );
      }

      this.logger.log(
        `[onboarding] Account unificada creada id=${accountId}`,
      );
      return [accountId];
    }

    // Multi-account: group payment methods by institution, create one account per unique institution
    const institutionMap = new Map<string, string>();
    const accountIds: string[] = [];

    for (const method of paymentMethods) {
      const key = (method.institution ?? 'default').toLowerCase();
      if (!institutionMap.has(key)) {
        const accountId = randomUUID();
        const isFirst = accountIds.length === 0;
        const { error } = await this.supabase.from('accounts').insert({
          id: accountId,
          user_id: userId,
          name: method.institution
            ? `Cuenta ${method.institution}`
            : 'Cuenta Principal',
          institution: method.institution ?? null,
          currency: method.currency ?? 'CLP',
          current_balance: isFirst ? initialBalance : 0,
        });

        if (error) {
          this.logger.error(
            `[onboarding] No se pudo crear account: ${error.message}`,
          );
          throw new InternalServerErrorException(
            'No se pudo crear la cuenta.',
          );
        }

        institutionMap.set(key, accountId);
        accountIds.push(accountId);
      }
    }

    this.logger.log(
      `[onboarding] ${accountIds.length} accounts creadas`,
    );
    return accountIds;
  }

  private async syncPaymentMethods(
    userId: string,
    answers: OnboardingAnswers,
    now: string,
    accountIds: string[] = [],
  ) {
    const paymentMethods = answers.payment_method ?? [];
    const unifiedBalance = answers.unifiedBalance ?? false;

    this.logger.log(
      `[onboarding] Sincronizando medios de pago para ${userId} total=${paymentMethods.length}, unifiedBalance=${unifiedBalance}`,
    );

    const { error: deleteError } = await this.supabase
      .from('payment_method')
      .delete()
      .eq('user_id', userId);
    if (deleteError) {
      this.logger.error(
        `[onboarding] No se pudo limpiar accounts previas: ${deleteError.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo preparar cuentas previas.',
      );
    }

    if (!paymentMethods.length) {
      this.logger.log('[onboarding] No se recibieron medios de pago.');
      return;
    }

    // Look up accounts by institution to link payment methods
    const { data: userAccounts } = await this.supabase
      .from('accounts')
      .select('id, institution')
      .eq('user_id', userId);

    const records = paymentMethods.map((method) => {
      // Find matching account by institution
      const matchedAccount = userAccounts?.find(
        (a: any) =>
          (a.institution ?? '').toLowerCase() ===
          (method.institution ?? '').toLowerCase(),
      );
      return {
        id: randomUUID(),
        user_id: userId,
        name: method.name,
        institution: method.institution,
        payment_type: method.payment_type,
        currency: method.currency,
        number_masked: this.parser.sanitizeMaskedDigits(method.number_masked),
        account_id: matchedAccount?.id ?? accountIds[0] ?? null,
      };
    });

    const { error } = await this.supabase
      .from('payment_method')
      .insert(records);
    if (error) {
      this.logger.error(
        `[onboarding] No se pudieron guardar las cuentas: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudieron guardar las cuentas.',
      );
    }
  }

  private async syncCategories(
    userId: string,
    answers: OnboardingAnswers,
    now: string,
  ) {
    this.logger.log(
      `[onboarding] Sincronizando categorías para ${userId} total=${answers.categories?.length ?? 0}`,
    );
    const { error: deleteError } = await this.supabase
      .from('categories')
      .delete()
      .eq('user_id', userId);
    if (deleteError) {
      this.logger.error(
        `[onboarding] No se pudieron limpiar categorías previas: ${deleteError.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudieron preparar las categorías previas.',
      );
    }

    if (!answers.categories?.length) {
      this.logger.log(
        '[onboarding] No se recibieron categorías, se mantiene lista vacía.',
      );
      return;
    }

    const records: Array<Record<string, any>> = [];

    answers.categories.forEach((category) => {
      const parentId = randomUUID();
      records.push({
        id: parentId,
        user_id: userId,
        name: category.name,
        parent_id: null,
        icon: category.icon ?? null,
        budget: 0,
        created_at: now,
      });

      if (category.children?.length) {
        category.children.forEach((child) => {
          records.push({
            id: randomUUID(),
            user_id: userId,
            name: child.name,
            parent_id: parentId,
            icon: child.icon ?? null,
            budget: 0,
            created_at: now,
          });
        });
      }
    });

    const { error } = await this.supabase.from('categories').insert(records);
    if (error) {
      this.logger.error(
        `[onboarding] No se pudieron guardar las categorías: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudieron guardar las categorías.',
      );
    }
  }

  private async syncGoals(
    userId: string,
    answers: OnboardingAnswers,
    now: string,
  ) {
    this.logger.log(
      `[onboarding] Sincronizando metas para ${userId} total=${answers.goals?.length ?? 0}`,
    );
    const { error: deleteError } = await this.supabase
      .from('goals')
      .delete()
      .eq('user_id', userId);
    if (deleteError) {
      this.logger.error(
        `[onboarding] No se pudieron limpiar metas previas: ${deleteError.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudieron preparar las metas previas.',
      );
    }

    if (!answers.goals?.length) {
      this.logger.log('[onboarding] No se recibieron metas, lista vacía.');
      return;
    }

    const records =
      answers.goals?.map((goal) => {
        const targetAmountRaw =
          goal.targetAmount === null || goal.targetAmount === undefined
            ? 0
            : Number(goal.targetAmount);
        const targetAmount =
          Number.isFinite(targetAmountRaw) && targetAmountRaw > 0
            ? targetAmountRaw
            : 1; // DB check exige > 0; usamos mínimo 1 al faltar dato
        const progressRaw =
          goal.progressAmount === null || goal.progressAmount === undefined
            ? 0
            : Number(goal.progressAmount);
        const progress_amount = Number.isFinite(progressRaw)
          ? Math.max(0, Math.min(progressRaw, targetAmount))
          : 0;

        return {
          id: randomUUID(),
          user_id: userId,
          name: goal.name,
          description: goal.description ?? null,
          target_amount: targetAmount,
          target_date: goal.targetDate ?? null,
          progress_amount,
          status: 'in_progress',
          created_at: now,
          updated_at: now,
        };
      }) ?? [];

    const normalizedRecords = records.map((record) => ({
      ...record,
      target_amount:
        record.target_amount === null || record.target_amount === undefined
          ? 1
          : record.target_amount,
      progress_amount:
        record.progress_amount === null || record.progress_amount === undefined
          ? 0
          : record.progress_amount,
    }));
    this.logger.debug(
      `[onboarding] Goals normalized=${JSON.stringify(
        normalizedRecords.map((r) => ({
          id: r.id,
          name: r.name,
          target_amount: r.target_amount,
          target_date: r.target_date,
        })),
      )}`,
    );

    const { error } = await this.supabase
      .from('goals')
      .insert(normalizedRecords);
    if (error) {
      this.logger.error(
        `[onboarding] No se pudieron guardar las metas: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudieron guardar las metas.',
      );
    }
  }
}
