/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'; // Added useRef import just in case it was missed, though likely already present
import { ProviderLogo } from '../util/ProviderLogo.js'
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VaderStatefulModelInfo, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, nonlocalProviderNames, localProviderNames, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled, FeatureName, hasDownloadButtonsOnModelsProviderNames, subTextMdOfProviderName, ChatMode } from '../../../../common/vaderSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VaderButtonBgDarken, VaderCustomDropdownBox, VaderInputBox2, VaderSimpleInputBox, VaderSwitch } from '../util/inputs.js'
import { filterProviders } from '../../../../common/providerSearch.js'
import { useAccessor, useIsDark, useRefreshModelListener, useRefreshModelState, useCloudModelListState, useSettingsState, useAgentsServiceState, usePolicyServiceState, useModelRouterServiceState, useSkillsState, useMemoryState, useOrchestrationRunsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, Asterisk, Plus, Sparkles, Brain, HardDrive, Cloud, SlidersHorizontal, Plug, List, Bot, BookOpen, Puzzle, ShieldCheck, Database, Info, Terminal } from 'lucide-react'
import { URI } from '../../../../../../../base/common/uri.js'
import { ModelDropdown } from './ModelDropdown.js'
import { ExternalAgentsSection } from './ExternalAgents.js'
import { redactSettingsForExport, mergeImportedSettings } from '../../../../common/helpers/settingsPortability.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { IconLoading } from '../sidebar-tsx/SidebarChat.js'
import { ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js'
import Severity from '../../../../../../../base/common/severity.js'
import { getModelCapabilities, modelOverrideKeys, ModelOverrides } from '../../../../common/modelCapabilities.js';
import { RouterCategory } from '../../../../common/modelRouter/modelRouterService.js';
import { PolicyRequestKind, UserPolicyRuleInput } from '../../../../common/policy/policyService.js';
import { validateUserPattern } from '../../../../common/helpers/safeRegex.js';
import { TransferEditorType, TransferFilesInfo, transferEditorTypes } from '../../../extensionTransferTypes.js';
import { MCPServer } from '../../../../common/mcpServiceTypes.js';
import { useMCPServiceState } from '../util/services.js';
import { isCloudListedProvider } from '../../../../common/cloudModelListTypes.js';
import { TrustMeter } from '../vader-marketplace-tsx/Store.js';
import { ADDON_SOURCES, AddonSourceKind, isSourceOn } from '../../../../common/marketplace/addonSources.js';
import { parseTrustHistory, TRUST_HISTORY_STORAGE_KEY } from '../../../../common/marketplace/trustHistory.js';
import { StorageScope } from '../../../../../../../platform/storage/common/storage.js';
import { VADER_OPEN_ADDONS_ACTION_ID } from '../../../actionIDs.js';
import { formatUsd, formatTokens, formatCost, PROVIDER_USAGE_PAGES } from '../../../../common/usageAccounting.js';
import { computeTrust } from '../../../../common/marketplace/trustScore.js';

type Tab =
	| 'models'
	| 'externalAgents'
	| 'localProviders'
	| 'providers'
	| 'agent'
	| 'context'
	| 'featureOptions'
	| 'skills'
	| 'mcp'
	| 'extensions'
	| 'privacy'
	| 'data'
	| 'about'
	| 'all';


const ButtonLeftTextRightOption = ({ text, leftButton }: { text: string, leftButton?: React.ReactNode }) => {

	return <div className='flex items-center text-vader-fg-3 px-3 py-0.5 rounded-sm overflow-hidden gap-2'>
		{leftButton ? leftButton : null}
		<span>
			{text}
		</span>
	</div>
}

// models
const RefreshModelButton = ({ providerName }: { providerName: RefreshableProviderName }) => {

	const refreshModelState = useRefreshModelState()

	const accessor = useAccessor()
	const refreshModelService = accessor.get('IRefreshModelService')
	const metricsService = accessor.get('IMetricsService')

	const [justFinished, setJustFinished] = useState<null | 'finished' | 'error'>(null)

	useRefreshModelListener(
		useCallback((providerName2, refreshModelState) => {
			if (providerName2 !== providerName) return
			const { state } = refreshModelState[providerName]
			if (!(state === 'finished' || state === 'error')) return
			// now we know we just entered 'finished' state for this providerName
			setJustFinished(state)
			const tid = setTimeout(() => { setJustFinished(null) }, 2000)
			return () => clearTimeout(tid)
		}, [providerName])
	)

	const { state } = refreshModelState[providerName]

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <ButtonLeftTextRightOption

		leftButton={
			<button
				className='flex items-center'
				disabled={state === 'refreshing' || justFinished !== null}
				onClick={() => {
					refreshModelService.startRefreshingModels(providerName, { enableProviderOnSuccess: false, doNotFire: false })
					metricsService.capture('Click', { providerName, action: 'Refresh Models' })
				}}
			>
				{justFinished === 'finished' ? <Check className='stroke-green-500 size-3' />
					: justFinished === 'error' ? <X className='stroke-red-500 size-3' />
						: state === 'refreshing' ? <Loader2 className='size-3 animate-spin' />
							: <RefreshCw className='size-3' />}
			</button>
		}

		text={justFinished === 'finished' ? `${providerTitle} Models are up-to-date!`
			: justFinished === 'error' ? `${providerTitle} not found!`
				: `Manually refresh ${providerTitle} models.`}
	/>
}

const RefreshableModels = () => {
	const settingsState = useSettingsState()


	const buttons = refreshableProviderNames.map(providerName => {
		if (!settingsState.settingsOfProvider[providerName]._didFillInProviderSettings) return null
		return <RefreshModelButton key={providerName} providerName={providerName} />
	})

	return <>
		{buttons}
	</>

}



export const AnimatedCheckmarkButton = ({ text, className }: { text?: string, className?: string }) => {
	const [dashOffset, setDashOffset] = useState(40);

	useEffect(() => {
		const startTime = performance.now();
		const duration = 500; // 500ms animation

		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const newOffset = 40 - (progress * 40);

			setDashOffset(newOffset);

			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		};

		const animationId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animationId);
	}, []);

	return <div
		className={`flex items-center gap-1.5 w-fit
			${className ? className : `px-2 py-0.5 text-xs text-zinc-900 bg-zinc-100 rounded-sm`}
		`}
	>
		<svg className="size-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M5 13l4 4L19 7"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{
					strokeDasharray: 40,
					strokeDashoffset: dashOffset
				}}
			/>
		</svg>
		{text}
	</div>
}


const AddButton = ({ disabled, text = 'Add', ...props }: { disabled?: boolean, text?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		disabled={disabled}
		className={`bg-[#0e70c0] px-3 py-1 text-white rounded-sm ${!disabled ? 'hover:bg-[#1177cb] cursor-pointer' : 'opacity-50 cursor-not-allowed bg-opacity-70'}`}
		{...props}
	>{text}</button>

}

// ConfirmButton prompts for a second click to confirm an action, cancels if clicking outside
const ConfirmButton = ({ children, onConfirm, className }: { children: React.ReactNode, onConfirm: () => void, className?: string }) => {
	const [confirm, setConfirm] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!confirm) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setConfirm(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [confirm]);
	return (
		<div ref={ref} className={`inline-block`}>
			<VaderButtonBgDarken className={className} onClick={() => {
				if (!confirm) {
					setConfirm(true);
				} else {
					onConfirm();
					setConfirm(false);
				}
			}}>
				{confirm ? `Confirm Reset` : children}
			</VaderButtonBgDarken>
		</div>
	);
};

// ---------------- Simplified Model Settings Dialog ------------------

// keys of ModelOverrides we allow the user to override



// This new dialog replaces the verbose UI with a single JSON override box.
const SimpleModelSettingsDialog = ({
	isOpen,
	onClose,
	modelInfo,
}: {
	isOpen: boolean;
	onClose: () => void;
	modelInfo: { modelName: string; providerName: ProviderName; type: 'autodetected' | 'custom' | 'default' } | null;
}) => {
	if (!isOpen || !modelInfo) return null;

	const { modelName, providerName, type } = modelInfo;
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const mouseDownInsideModal = useRef(false); // Ref to track mousedown origin
	const settingsStateService = accessor.get('IVaderSettingsService')

	// current overrides and defaults
	const defaultModelCapabilities = getModelCapabilities(providerName, modelName, undefined);
	const currentOverrides = settingsState.overridesOfModel?.[providerName]?.[modelName] ?? undefined;
	const { recognizedModelName, isUnrecognizedModel } = defaultModelCapabilities

	// Create the placeholder with the default values for allowed keys
	const partialDefaults: Partial<ModelOverrides> = {};
	for (const k of modelOverrideKeys) { if (defaultModelCapabilities[k]) partialDefaults[k] = defaultModelCapabilities[k] as any; }
	const placeholder = JSON.stringify(partialDefaults, null, 2);

	const [overrideEnabled, setOverrideEnabled] = useState<boolean>(() => !!currentOverrides);

	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

	// reset when dialog toggles
	useEffect(() => {
		if (!isOpen) return;
		const cur = settingsState.overridesOfModel?.[providerName]?.[modelName];
		setOverrideEnabled(!!cur);
		setErrorMsg(null);
	}, [isOpen, providerName, modelName, settingsState.overridesOfModel, placeholder]);

	const onSave = async () => {
		// if disabled override, reset overrides
		if (!overrideEnabled) {
			await settingsStateService.setOverridesOfModel(providerName, modelName, undefined);
			onClose();
			return;
		}

		// enabled overrides
		// parse json
		let parsedInput: Record<string, unknown>

		if (textAreaRef.current?.value) {
			try {
				parsedInput = JSON.parse(textAreaRef.current.value);
			} catch (e) {
				setErrorMsg('Invalid JSON');
				return;
			}
		} else {
			setErrorMsg('Invalid JSON');
			return;
		}

		// only keep allowed keys
		const cleaned: Partial<ModelOverrides> = {};
		for (const k of modelOverrideKeys) {
			if (!(k in parsedInput)) continue
			const isEmpty = parsedInput[k] === '' || parsedInput[k] === null || parsedInput[k] === undefined;
			if (!isEmpty) {
				cleaned[k] = parsedInput[k] as any;
			}
		}
		await settingsStateService.setOverridesOfModel(providerName, modelName, cleaned);
		onClose();
	};

	const sourcecodeOverridesLink = `https://github.com/qwzx4893-stack/Vader/blob/main/src/vs/workbench/contrib/vader/common/modelCapabilities.ts`

	return (
		<div // Backdrop
			className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999999]"
			onMouseDown={() => {
				mouseDownInsideModal.current = false;
			}}
			onMouseUp={() => {
				if (!mouseDownInsideModal.current) {
					onClose();
				}
				mouseDownInsideModal.current = false;
			}}
		>
			{/* MODAL */}
			<div
				className="bg-vader-bg-1 rounded-md p-4 max-w-xl w-full shadow-xl overflow-y-auto max-h-[90vh]"
				onClick={(e) => e.stopPropagation()} // Keep stopping propagation for normal clicks inside
				onMouseDown={(e) => {
					mouseDownInsideModal.current = true;
					e.stopPropagation();
				}}
			>
				<div className="flex justify-between items-center mb-4">
					<h3 className="text-lg font-medium">
						Change Defaults for {modelName} ({displayInfoOfProviderName(providerName).title})
					</h3>
					<button
						onClick={onClose}
						className="text-vader-fg-3 hover:text-vader-fg-1"
					>
						<X className="size-5" />
					</button>
				</div>

				{/* Display model recognition status */}
				<div className="text-sm text-vader-fg-3 mb-4">
					{type === 'default' ? `${modelName} comes packaged with Vader, so you shouldn't need to change these settings.`
						: isUnrecognizedModel
							? `Model not recognized by Vader.`
							: `Vader recognizes ${modelName} ("${recognizedModelName}").`}
				</div>


				{/* override toggle */}
				<div className="flex items-center gap-2 mb-4">
					<VaderSwitch size='xs' value={overrideEnabled} onChange={setOverrideEnabled} />
					<span className="text-vader-fg-3 text-sm">Override model defaults</span>
				</div>

				{/* Informational link */}
				{overrideEnabled && <div className="text-sm text-vader-fg-3 mb-4">
					<ChatMarkdownRender string={`See the [sourcecode](${sourcecodeOverridesLink}) for a reference on how to set this JSON (advanced).`} chatMessageLocation={undefined} />
				</div>}

				<textarea
					key={overrideEnabled + ''}
					ref={textAreaRef}
					className={`w-full min-h-[200px] p-2 rounded-sm border border-vader-border-2 bg-vader-bg-2 resize-none font-mono text-sm ${!overrideEnabled ? 'text-vader-fg-3' : ''}`}
					defaultValue={overrideEnabled && currentOverrides ? JSON.stringify(currentOverrides, null, 2) : placeholder}
					placeholder={placeholder}
					readOnly={!overrideEnabled}
				/>
				{errorMsg && (
					<div className="text-red-500 mt-2 text-sm">{errorMsg}</div>
				)}


				<div className="flex justify-end gap-2 mt-4">
					<VaderButtonBgDarken onClick={onClose} className="px-3 py-1">
						Cancel
					</VaderButtonBgDarken>
					<VaderButtonBgDarken
						onClick={onSave}
						className="px-3 py-1 bg-[#0e70c0] text-white"
					>
						Save
					</VaderButtonBgDarken>
				</div>
			</div>
		</div>
	);
};




export const ModelDump = ({ filteredProviders }: { filteredProviders?: ProviderName[] }) => {
	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()

	// State to track which model's settings dialog is open
	const [openSettingsModel, setOpenSettingsModel] = useState<{
		modelName: string,
		providerName: ProviderName,
		type: 'autodetected' | 'custom' | 'default'
	} | null>(null);

	// States for add model functionality
	const [isAddModelOpen, setIsAddModelOpen] = useState(false);
	const [showCheckmark, setShowCheckmark] = useState(false);
	const [userChosenProviderName, setUserChosenProviderName] = useState<ProviderName | null>(null);
	const [modelName, setModelName] = useState<string>('');
	const [errorString, setErrorString] = useState('');

	// a dump of all the enabled providers' models
	const modelDump: (VaderStatefulModelInfo & { providerName: ProviderName, providerEnabled: boolean })[] = []

	// Use either filtered providers or all providers
	const providersToShow = filteredProviders || providerNames;

	for (let providerName of providersToShow) {
		const providerSettings = settingsState.settingsOfProvider[providerName]
		// if (!providerSettings.enabled) continue
		modelDump.push(...providerSettings.models.map(model => ({ ...model, providerName, providerEnabled: !!providerSettings._didFillInProviderSettings })))
	}

	// sort by hidden
	modelDump.sort((a, b) => {
		return Number(b.providerEnabled) - Number(a.providerEnabled)
	})

	// Add model handler
	const handleAddModel = () => {
		if (!userChosenProviderName) {
			setErrorString('Please select a provider.');
			return;
		}
		if (!modelName) {
			setErrorString('Please enter a model name.');
			return;
		}

		// Check if model already exists
		if (settingsState.settingsOfProvider[userChosenProviderName].models.find(m => m.modelName === modelName)) {
			setErrorString(`This model already exists.`);
			return;
		}

		settingsStateService.addModel(userChosenProviderName, modelName);
		setShowCheckmark(true);
		setTimeout(() => {
			setShowCheckmark(false);
			setIsAddModelOpen(false);
			setUserChosenProviderName(null);
			setModelName('');
		}, 1500);
		setErrorString('');
	};

	return <div className=''>
		{modelDump.map((m, i) => {
			const { isHidden, type, modelName, providerName, providerEnabled } = m

			const isNewProviderName = (i > 0 ? modelDump[i - 1] : undefined)?.providerName !== providerName

			const providerTitle = displayInfoOfProviderName(providerName).title

			const disabled = !providerEnabled
			const value = disabled ? false : !isHidden

			const tooltipName = (
				disabled ? `Add ${providerTitle} to enable`
					: value === true ? 'Show in Dropdown'
						: 'Hide from Dropdown'
			)


			const detailAboutModel = type === 'autodetected' ?
				<Asterisk size={14} className="inline-block align-text-top brightness-115 stroke-[2] text-[#0e70c0]" data-tooltip-id='vader-tooltip' data-tooltip-place='right' data-tooltip-content='Detected locally' />
				: type === 'custom' ?
					<Asterisk size={14} className="inline-block align-text-top brightness-115 stroke-[2] text-[#0e70c0]" data-tooltip-id='vader-tooltip' data-tooltip-place='right' data-tooltip-content='Custom model' />
					: undefined

			const hasOverrides = !!settingsState.overridesOfModel?.[providerName]?.[modelName]

			return <div key={`${modelName}${providerName}`}
				className={`flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate group
				`}
			>
				{/* left part is width:full */}
				<div className={`flex flex-grow items-center gap-4`}>
					<span className='w-full max-w-32 flex items-center gap-1.5 truncate'>{isNewProviderName ? <><ProviderLogo providerName={providerName} size={14} /><span className='truncate'>{providerTitle}</span></> : ''}</span>
					<span className='w-fit max-w-[400px] truncate'>{modelName}</span>
				</div>

				{/* right part is anything that fits */}
				<div className="flex items-center gap-2 w-fit">

					{/* Advanced Settings button (gear). Hide entirely when provider/model disabled. */}
					{disabled ? null : (
						<div className="w-5 flex items-center justify-center">
							<button
								onClick={() => { setOpenSettingsModel({ modelName, providerName, type }) }}
								data-tooltip-id='vader-tooltip'
								data-tooltip-place='right'
								data-tooltip-content='Advanced Settings'
								className={`${hasOverrides ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
							>
								<Plus size={12} className="text-vader-fg-3 opacity-50" />
							</button>
						</div>
					)}

					{/* Blue star */}
					{detailAboutModel}


					{/* Switch */}
					<VaderSwitch
						value={value}
						onChange={() => { settingsStateService.toggleModelHidden(providerName, modelName); }}
						disabled={disabled}
						size='sm'

						data-tooltip-id='vader-tooltip'
						data-tooltip-place='right'
						data-tooltip-content={tooltipName}
					/>

					{/* X button */}
					<div className={`w-5 flex items-center justify-center`}>
						{type === 'default' || type === 'autodetected' ? null : <button
							onClick={() => { settingsStateService.deleteModel(providerName, modelName); }}
							data-tooltip-id='vader-tooltip'
							data-tooltip-place='right'
							data-tooltip-content='Delete'
							className={`${hasOverrides ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}
						>
							<X size={12} className="text-vader-fg-3 opacity-50" />
						</button>}
					</div>
				</div>
			</div>
		})}

		{/* Add Model Section */}
		{showCheckmark ? (
			<div className="mt-4">
				<AnimatedCheckmarkButton text='Added' className="bg-[#0e70c0] text-white px-3 py-1 rounded-sm" />
			</div>
		) : isAddModelOpen ? (
			<div className="mt-4">
				<form className="flex items-center gap-2">

					{/* Provider dropdown */}
					<ErrorBoundary>
						<VaderCustomDropdownBox
							options={providersToShow}
							selectedOption={userChosenProviderName}
							onChangeOption={(pn) => setUserChosenProviderName(pn)}
							getOptionDisplayName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
							getOptionDropdownName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
							getOptionsEqual={(a, b) => a === b}
							className="max-w-32 mx-2 w-full resize-none bg-vader-bg-1 text-vader-fg-1 placeholder:text-vader-fg-3 border border-vader-border-2 focus:border-vader-border-1 py-1 px-2 rounded"
							arrowTouchesText={false}
						/>
					</ErrorBoundary>

					{/* Model name input */}
					<ErrorBoundary>
						<VaderSimpleInputBox
							value={modelName}
							compact={true}
							onChangeValue={setModelName}
							placeholder='Model Name'
							className='max-w-32'
						/>
					</ErrorBoundary>

					{/* Add button */}
					<ErrorBoundary>
						<AddButton
							type='button'
							disabled={!modelName || !userChosenProviderName}
							onClick={handleAddModel}
						/>
					</ErrorBoundary>

					{/* X button to cancel */}
					<button
						type="button"
						onClick={() => {
							setIsAddModelOpen(false);
							setErrorString('');
							setModelName('');
							setUserChosenProviderName(null);
						}}
						className='text-vader-fg-4'
					>
						<X className='size-4' />
					</button>
				</form>

				{errorString && (
					<div className='text-red-500 truncate whitespace-nowrap mt-1'>
						{errorString}
					</div>
				)}
			</div>
		) : (
			<div
				className="text-vader-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer mt-4"
				onClick={() => setIsAddModelOpen(true)}
			>
				<div className="flex items-center gap-1">
					<Plus size={16} />
					<span>Add a model</span>
				</div>
			</div>
		)}

		{/* Model Settings Dialog */}
		<SimpleModelSettingsDialog
			isOpen={openSettingsModel !== null}
			onClose={() => setOpenSettingsModel(null)}
			modelInfo={openSettingsModel}
		/>
	</div>
}



// providers

const ProviderSetting = ({ providerName, settingName, subTextMd }: { providerName: ProviderName, settingName: SettingName, subTextMd: React.ReactNode }) => {

	const { title: settingTitle, placeholder, isPasswordField } = displayInfoOfSettingName(providerName, settingName)

	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()

	const settingValue = settingsState.settingsOfProvider[providerName][settingName] as string // this should always be a string in this component
	if (typeof settingValue !== 'string') {
		console.log('Error: Provider setting had a non-string value.')
		return
	}

	// Create a stable callback reference using useCallback with proper dependencies
	const handleChangeValue = useCallback((newVal: string) => {
		vaderSettingsService.setSettingOfProvider(providerName, settingName, newVal)
	}, [vaderSettingsService, providerName, settingName]);

	return <ErrorBoundary>
		<div className='my-1'>
			<VaderSimpleInputBox
				value={settingValue}
				onChangeValue={handleChangeValue}
				placeholder={`${settingTitle} (${placeholder})`}
				passwordBlur={isPasswordField}
				compact={true}
			/>
			{!subTextMd ? null : <div className='py-1 px-3 opacity-50 text-sm'>
				{subTextMd}
			</div>}
		</div>
	</ErrorBoundary>
}

// const OldSettingsForProvider = ({ providerName, showProviderTitle }: { providerName: ProviderName, showProviderTitle: boolean }) => {
// 	const vaderSettingsState = useSettingsState()

// 	const needsModel = isProviderNameDisabled(providerName, vaderSettingsState) === 'addModel'

// 	// const accessor = useAccessor()
// 	// const vaderSettingsService = accessor.get('IVaderSettingsService')

// 	// const { enabled } = vaderSettingsState.settingsOfProvider[providerName]
// 	const settingNames = customSettingNamesOfProvider(providerName)

// 	const { title: providerTitle } = displayInfoOfProviderName(providerName)

// 	return <div className='my-4'>

// 		<div className='flex items-center w-full gap-4'>
// 			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

// 			{/* enable provider switch */}
// 			{/* <VaderSwitch
// 				value={!!enabled}
// 				onChange={
// 					useCallback(() => {
// 						const enabledRef = vaderSettingsService.state.settingsOfProvider[providerName].enabled
// 						vaderSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
// 					}, [vaderSettingsService, providerName])}
// 				size='sm+'
// 			/> */}
// 		</div>

// 		<div className='px-0'>
// 			{/* settings besides models (e.g. api key) */}
// 			{settingNames.map((settingName, i) => {
// 				return <ProviderSetting key={settingName} providerName={providerName} settingName={settingName} />
// 			})}

// 			{needsModel ?
// 				providerName === 'ollama' ?
// 					<WarningBox text={`Please install an Ollama model. We'll auto-detect it.`} />
// 					: <WarningBox text={`Please add a model for ${providerTitle} (Models section).`} />
// 				: null}
// 		</div>
// 	</div >
// }


// Vader addition: tells the user whether the key they typed works and how many models it unlocks (live list from the provider)
const CloudModelListStatus = ({ providerName }: { providerName: ProviderName }) => {
	const accessor = useAccessor()
	const refreshModelService = accessor.get('IRefreshModelService')
	const cloudState = useCloudModelListState()
	if (!isCloudListedProvider(providerName)) {
		// no list to ask for here: local servers are detected, everything else is typed in by name
		if (providerName === 'ollama' || providerName === 'vLLM' || providerName === 'lmStudio') return null
		return <div className='py-1 px-3 text-sm opacity-70' data-testid='vader-no-live-list'>
			{providerName === 'openAICompatible' ? 'This endpoint has no model catalogue here: add the models it serves with "Add model".'
				: 'This provider publishes no list of models that Vader can ask for: add the model or deployment you use with "Add model".'}
		</div>
	}
	const st = cloudState[providerName]
	if (st.status === 'idle') return null

	return <div className='py-1 px-3 text-sm flex items-center gap-2' data-testid='vader-cloud-models-status' data-status={st.status}>
		{st.status === 'loading' && <><Loader2 className='size-3 animate-spin' /><span className='opacity-70'>Checking the key with the provider...</span></>}
		{st.status === 'ok' && <><Check className='size-3 text-green-500' /><span className='opacity-80'>Key works - {st.count} model{st.count === 1 ? '' : 's'} available to you.</span></>}
		{st.status === 'error' && <>
			<X className='size-3 text-red-500' />
			<span className='opacity-80'>{st.message}{st.reason === 'unauthorized' ? '' : st.reason === 'unsupported' ? ' Add the model you use by name with "Add model".' : ' No models are listed until the provider answers; you can still add a model by name.'}</span>
			<button className='underline opacity-70 hover:opacity-100' onClick={() => refreshModelService.refreshCloudModels(providerName)}>Retry</button>
		</>}
	</div>
}

export const SettingsForProvider = ({ providerName, showProviderTitle, showProviderSuggestions }: { providerName: ProviderName, showProviderTitle: boolean, showProviderSuggestions: boolean }) => {
	const vaderSettingsState = useSettingsState()

	const needsModel = isProviderNameDisabled(providerName, vaderSettingsState) === 'addModel'

	// const accessor = useAccessor()
	// const vaderSettingsService = accessor.get('IVaderSettingsService')

	// const { enabled } = vaderSettingsState.settingsOfProvider[providerName]
	const settingNames = customSettingNamesOfProvider(providerName)

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <div>

		<div className='flex items-center w-full gap-4'>
			{showProviderTitle && <h3 className='text-xl truncate flex items-center gap-2'><ProviderLogo providerName={providerName} size={20} /><span className='truncate'>{providerTitle}</span></h3>}

			{/* enable provider switch */}
			{/* <VaderSwitch
				value={!!enabled}
				onChange={
					useCallback(() => {
						const enabledRef = vaderSettingsService.state.settingsOfProvider[providerName].enabled
						vaderSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
					}, [vaderSettingsService, providerName])}
				size='sm+'
			/> */}
		</div>

		<div className='px-0'>
			{/* settings besides models (e.g. api key) */}
			{settingNames.map((settingName, i) => {

				return <ProviderSetting
					key={settingName}
					providerName={providerName}
					settingName={settingName}
					subTextMd={i !== settingNames.length - 1 ? null
						: <ChatMarkdownRender string={subTextMdOfProviderName(providerName)} chatMessageLocation={undefined} />}
				/>
			})}

			<CloudModelListStatus providerName={providerName} />

			{showProviderSuggestions && needsModel ?
				providerName === 'ollama' ?
					<WarningBox className="pl-2 mb-4" text={`Please install an Ollama model. We'll auto-detect it.`} />
					: <WarningBox className="pl-2 mb-4" text={`Please add a model for ${providerTitle} (Models section).`} />
				: null}
		</div>
	</div >
}


// Vader addition: manage permanent agents and the policy engine's permission mode.
// See common/agents/agentsService.ts and common/policy/policyService.ts.
export const AgentsAndPolicySection = () => {
	const accessor = useAccessor()
	const agentsService = accessor.get('IAgentsService')
	const policyService = accessor.get('IPolicyService')
	const chatThreadService = accessor.get('IChatThreadService')

	const agentsState = useAgentsServiceState()
	const policyState = usePolicyServiceState()

	const [showNewAgentForm, setShowNewAgentForm] = useState(false)
	const [newName, setNewName] = useState('')
	const [newDescription, setNewDescription] = useState('')
	const [newInstructions, setNewInstructions] = useState('')

	const [showNewRuleForm, setShowNewRuleForm] = useState(false)
	const [newRuleKind, setNewRuleKind] = useState<PolicyRequestKind>('terminal-command')
	const [newRuleEffect, setNewRuleEffect] = useState<'deny' | 'ask'>('ask')
	const [newRuleDescription, setNewRuleDescription] = useState('')
	const [newRulePattern, setNewRulePattern] = useState('')
	const [newRuleError, setNewRuleError] = useState('')

	const currentThread = chatThreadService.getCurrentThread()
	const customRules = policyService.getAllRules().filter(r => !r.builtIn)

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Agents & Permissions</h2>
		<h4 className={`text-vader-fg-3 mb-4`}>
			Permanent agents are named identities with their own instructions, model, and tool/file restrictions that persist across sessions. The permission mode below controls how much the policy engine lets an agent do without asking first - even in Autonomous mode, a small set of hard rules (destructive commands, credential files) can never be bypassed.
		</h4>

		<div className='my-4'>
			<div className='text-vader-fg-3 text-sm mb-1'>Permission mode</div>
			<div className='flex gap-x-2'>
				{(['safe', 'balanced', 'autonomous'] as const).map(mode => (
					<VaderButtonBgDarken
						key={mode}
						className={`px-3 py-1 capitalize ${policyState.mode === mode ? 'ring-1 ring-vader-fg-3' : ''}`}
						onClick={() => policyService.setMode(mode)}
					>
						{mode}
					</VaderButtonBgDarken>
				))}
			</div>
		</div>

		<div className='my-4'>
			<div className='text-vader-fg-3 text-sm mb-2'>Custom policy rules ({customRules.length})</div>
			<div className='text-vader-fg-3 text-xs italic mb-2'>Hard rules beyond the built-in ones below - e.g. "ask before any MCP tool call" or "deny terminal commands matching /rm -rf/". These are evaluated the same way as built-in rules: before any approval prompt, regardless of auto-approve settings.</div>
			<div className='flex flex-col gap-y-2'>
				{customRules.map(rule => (
					<div key={rule.id} className='border border-vader-border-3 rounded p-2 flex items-center justify-between'>
						<div>
							<span className={`text-xs uppercase mr-2 ${rule.effect === 'deny' ? 'text-red-500' : 'text-vader-fg-3'}`}>{rule.effect}</span>
							<span className='text-xs'>{rule.description}</span>
						</div>
						<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => policyService.removeCustomRule(rule.id)}>Remove</VaderButtonBgDarken>
					</div>
				))}
			</div>
			<div className='mt-2'>
				{!showNewRuleForm ? (
					<VaderButtonBgDarken className='px-3 py-1' onClick={() => setShowNewRuleForm(true)}>+ New Rule</VaderButtonBgDarken>
				) : (
					<div className='flex flex-col gap-y-2 border border-vader-border-3 rounded p-3'>
						<div className='flex gap-x-2'>
							<VaderCustomDropdownBox
								className='text-xs bg-vader-bg-1 border border-vader-border-2 rounded py-0.5 px-1'
								options={['file-write', 'file-delete', 'terminal-command', 'mcp-tool'] as PolicyRequestKind[]}
								selectedOption={newRuleKind}
								onChangeOption={setNewRuleKind}
								getOptionDisplayName={k => k}
								getOptionDropdownName={k => k}
								getOptionDropdownDetail={() => ''}
								getOptionsEqual={(a, b) => a === b}
							/>
							<VaderCustomDropdownBox
								className='text-xs bg-vader-bg-1 border border-vader-border-2 rounded py-0.5 px-1'
								options={['ask', 'deny'] as const}
								selectedOption={newRuleEffect}
								onChangeOption={setNewRuleEffect}
								getOptionDisplayName={k => k}
								getOptionDropdownName={k => k}
								getOptionDropdownDetail={() => ''}
								getOptionsEqual={(a, b) => a === b}
							/>
						</div>
						<VaderSimpleInputBox value={newRuleDescription} onChangeValue={setNewRuleDescription} placeholder='Description shown when this rule fires' />
						<VaderSimpleInputBox value={newRulePattern} onChangeValue={setNewRulePattern}
							placeholder={newRuleKind === 'file-write' || newRuleKind === 'file-delete' ? 'Glob pattern(s), comma-separated (e.g. **/.env*)'
								: newRuleKind === 'terminal-command' ? 'Regex pattern(s), comma-separated (e.g. rm -rf)'
									: 'MCP server name regex(es), comma-separated - leave empty to match every MCP server'} />
						{newRuleError && <div className='text-vader-warning text-xs' data-testid='vader-policy-rule-error'>{newRuleError}</div>}
						<div className='flex gap-x-2'>
							<VaderButtonBgDarken
								className='px-3 py-1'
								onClick={() => {
									if (!newRuleDescription.trim()) return
									const patterns = newRulePattern.split(',').map(s => s.trim()).filter(Boolean)
									if (patterns.length === 0 && newRuleKind !== 'mcp-tool') return // mcp-tool alone may deliberately have no patterns (matches every server); the others require a discriminator
									// regex rules run against every command: refuse patterns that are invalid or could hang the window (see policyService.ts)
									const regexKind = newRuleKind === 'terminal-command' || newRuleKind === 'mcp-tool'
									const problem = regexKind ? patterns.map(p => { try { new RegExp(p, 'i') } catch (e) { return `"${p}" is not a valid regular expression.` } return validateUserPattern(p) }).find(Boolean) : undefined
									if (problem) { setNewRuleError(problem); return }
									setNewRuleError('')
									const input: UserPolicyRuleInput = {
										description: newRuleDescription.trim(),
										effect: newRuleEffect,
										kinds: [newRuleKind],
										pathGlobs: newRuleKind === 'file-write' || newRuleKind === 'file-delete' ? patterns : undefined,
										commandPatterns: newRuleKind === 'terminal-command' ? patterns : undefined,
										serverNamePatterns: newRuleKind === 'mcp-tool' ? patterns : undefined,
									}
									policyService.addCustomRule(input)
									setNewRuleDescription(''); setNewRulePattern(''); setShowNewRuleForm(false)
								}}
							>Create</VaderButtonBgDarken>
							<VaderButtonBgDarken className='px-3 py-1' onClick={() => setShowNewRuleForm(false)}>Cancel</VaderButtonBgDarken>
						</div>
					</div>
				)}
			</div>
		</div>

		<div className='my-4'>
			<div className='text-vader-fg-3 text-sm mb-2'>Permanent agents ({agentsState.agents.length})</div>
			{agentsState.agents.length === 0 ? <div className='text-vader-fg-3 text-xs italic mb-2'>No permanent agents yet. Create one below, or ask the main agent to create one for a task it does repeatedly.</div> : null}
			<div className='flex flex-col gap-y-2'>
				{agentsState.agents.map(agent => (
					<div key={agent.id} className='border border-vader-border-3 rounded p-2 flex flex-col gap-y-1'>
						<div className='flex items-center justify-between'>
							<span className='font-medium'>{agent.name}</span>
							<div className='flex gap-x-1'>
								<VaderButtonBgDarken
									className={`px-2 py-0.5 text-xs ${currentThread.agentId === agent.id ? 'ring-1 ring-vader-fg-3' : ''}`}
									onClick={() => chatThreadService.setThreadAgentId(currentThread.id, currentThread.agentId === agent.id ? null : agent.id)}
								>
									{currentThread.agentId === agent.id ? 'In use (click to unset)' : 'Use in current chat'}
								</VaderButtonBgDarken>
								<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => agentsService.deleteAgent(agent.id)}>
									Delete
								</VaderButtonBgDarken>
							</div>
						</div>
						<span className='text-vader-fg-3 text-xs'>{agent.description}</span>
						{agent.createdBy === 'main-agent' ? <span className='text-vader-fg-3 text-xs italic'>Created by the main agent</span> : null}
					</div>
				))}
			</div>
		</div>

		<div className='my-4'>
			{!showNewAgentForm ? (
				<VaderButtonBgDarken className='px-3 py-1' onClick={() => setShowNewAgentForm(true)}>+ New Agent</VaderButtonBgDarken>
			) : (
				<div className='flex flex-col gap-y-2 border border-vader-border-3 rounded p-3'>
					<VaderSimpleInputBox value={newName} onChangeValue={setNewName} placeholder='Name (e.g. "Vulkan Specialist")' />
					<VaderSimpleInputBox value={newDescription} onChangeValue={setNewDescription} placeholder='One-sentence description' />
					<VaderInputBox2 initValue='' multiline onChangeText={setNewInstructions} placeholder='Instructions this agent should always follow' />
					<div className='flex gap-x-2'>
						<VaderButtonBgDarken
							className='px-3 py-1'
							onClick={() => {
								if (!newName.trim() || !newInstructions.trim()) return
								agentsService.createAgent({ name: newName.trim(), description: newDescription.trim(), instructions: newInstructions.trim() }, 'user')
								setNewName(''); setNewDescription(''); setNewInstructions(''); setShowNewAgentForm(false)
							}}
						>Create</VaderButtonBgDarken>
						<VaderButtonBgDarken className='px-3 py-1' onClick={() => setShowNewAgentForm(false)}>Cancel</VaderButtonBgDarken>
					</div>
				</div>
			)}
		</div>
	</div>
}


const ROUTER_CATEGORIES: { category: RouterCategory, label: string, desc: string }[] = [
	{ category: 'subagent', label: 'Subagent delegation', desc: 'Tasks handed off via delegate_subagent_task with no agent-pinned model.' },
	{ category: 'research', label: 'Research', desc: 'Read-only, information-gathering subagent work.' },
	{ category: 'browser', label: 'Browser automation', desc: 'Turns that primarily drive the browser tool.' },
	{ category: 'summarization', label: 'Summarization', desc: 'Context compaction\'s own summarization calls.' },
	{ category: 'verification', label: 'Verification', desc: 'The independent verification pass.' },
]

const DEFAULT_ROUTER_OPTION = '(default: Chat model)'

// Vader addition: check the estimate against the provider, and the person's own prices for a contract or an unknown model.
const PricesAndProviderPages = () => {
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const openerService = accessor.get('IOpenerService')
	const g = settingsState.globalSettings
	const withKey = Object.entries(PROVIDER_USAGE_PAGES).filter(([provider]) => (settingsState.settingsOfProvider as any)[provider]?._didFillInProviderSettings)
	const [discountText, setDiscountText] = useState(String(g.priceDiscountPercent || ''))
	const [model, setModel] = useState('')
	const [inText, setInText] = useState('')
	const [outText, setOutText] = useState('')
	const saveDiscount = (text: string) => {
		const n = Number(text)
		vaderSettingsService.setGlobalSetting('priceDiscountPercent', text.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100 ? 0 : n)
	}
	const overrides = g.modelPriceOverrides ?? {}
	const addOverride = () => {
		const i = Number(inText), o = Number(outText)
		if (!model.trim() || !Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) return
		vaderSettingsService.setGlobalSetting('modelPriceOverrides', { ...overrides, [model.trim()]: { input: i, output: o } })
		setModel(''); setInText(''); setOutText('')
	}
	const removeOverride = (name: string) => {
		const { [name]: _drop, ...rest } = overrides
		vaderSettingsService.setGlobalSetting('modelPriceOverrides', rest)
	}
	const field = 'px-2 py-0.5 rounded-sm border border-vader-border-2 bg-vader-bg-1 text-vader-fg-1 outline-none'
	return <div className='border border-vader-border-3 rounded p-2 mb-4 flex flex-col gap-3'>
		<div className='flex flex-col gap-1'>
			<span className='font-medium'>Check it against the provider</span>
			<span className='text-vader-fg-3 text-xs'>These pages show what each provider really charged. They open in your browser.</span>
			<div className='flex flex-wrap gap-2 mt-1'>
				{(withKey.length ? withKey : Object.entries(PROVIDER_USAGE_PAGES).slice(0, 4)).map(([provider, page]) => <VaderButtonBgDarken key={provider} className='px-2 py-0.5 text-xs' onClick={() => openerService.open(URI.parse(page!.url))}>{page!.label}</VaderButtonBgDarken>)}
			</div>
		</div>
		<div className='flex items-center justify-between gap-3'>
			<div className='flex flex-col'>
				<span>Discount on list prices</span>
				<span className='text-vader-fg-3 text-xs'>For a flat discount, such as 20% off. It changes the estimate only, never what you are charged.</span>
			</div>
			<div className='flex items-center gap-1'>
				<input className={`w-16 ${field}`} inputMode='decimal' value={discountText} placeholder='0' onChange={e => setDiscountText(e.target.value)} onBlur={() => saveDiscount(discountText)} onKeyDown={e => { if (e.key === 'Enter') saveDiscount(discountText) }} />
				<span className='text-vader-fg-3'>%</span>
			</div>
		</div>
		<div className='flex flex-col gap-1'>
			<span>Your own prices</span>
			<span className='text-vader-fg-3 text-xs'>For a model Vader has no price for, or a contract. US dollars per million tokens. A model the provider reports the charge for does not need one.</span>
			{Object.entries(overrides).map(([name, p]) => <div key={name} className='flex items-center gap-2 text-xs'>
				<span className='font-mono flex-1 truncate'>{name}</span>
				<span className='text-vader-fg-3'>in {p?.input} / out {p?.output}</span>
				<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => removeOverride(name)}>Remove</VaderButtonBgDarken>
			</div>)}
			<div className='flex items-center gap-2 mt-1'>
				<input className={`flex-1 min-w-0 ${field}`} placeholder='Model name' value={model} onChange={e => setModel(e.target.value)} />
				<input className={`w-16 ${field}`} inputMode='decimal' placeholder='Input' value={inText} onChange={e => setInText(e.target.value)} />
				<input className={`w-16 ${field}`} inputMode='decimal' placeholder='Output' value={outText} onChange={e => setOutText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addOverride() }} />
				<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={addOverride}>Add</VaderButtonBgDarken>
			</div>
		</div>
	</div>
}

// Vader addition: AUTO/MANUAL Model Router. See common/modelRouter/.
// Vader addition: today's spending, an optional daily limit, and the commands and tools allowed in this project without asking again.
export const SpendingAndProjectSection = () => {
	const accessor = useAccessor()
	const chatThreadService = accessor.get('IChatThreadService')
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()
	const [, tick] = useState(0)
	useEffect(() => {
		const a = chatThreadService.onDidChangeUsage(() => tick(n => n + 1))
		const b = chatThreadService.onDidChangeProjectApprovals(() => tick(n => n + 1))
		return () => { a.dispose(); b.dispose() }
	}, [chatThreadService])

	const limit = settingsState.globalSettings.dailySpendLimitUsd
	const [limitText, setLimitText] = useState(limit === null ? '' : String(limit))
	const today = chatThreadService.getUsageToday()
	const projectKey = chatThreadService.getCurrentProjectKey()
	const approvals = chatThreadService.listProjectApprovals(projectKey)
	const saveLimit = (text: string) => {
		const n = Number(text)
		vaderSettingsService.setGlobalSetting('dailySpendLimitUsd', text.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n)
	}

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Spending and approvals</h2>
		<h4 className={`text-vader-fg-3 mb-4`}>Vader counts the tokens each provider reports. The money is worked out from list prices, so it is an estimate (shown with ≈) unless the provider says what it charged. Your provider's own page is the bill. Below that: the commands you chose to stop being asked about.</h4>

		<div className='border border-vader-border-3 rounded p-2 mb-4'>
			<div className='flex items-center justify-between'>
				<span className='font-medium'>Today</span>
				<span>{formatCost(today.costUsd, today.billedCostUsd)}{today.unpricedTurns > 0 ? ' +' : ''} <span className='text-vader-fg-3 text-xs'>{formatTokens(today.inputTokens)} in, {formatTokens(today.outputTokens)} out</span></span>
			</div>
			{today.unpricedTurns > 0 ? <div className='text-vader-fg-3 text-xs mt-1'>{today.unpricedTurns} answer(s) came from a model whose price Vader does not know; they are not in the amount (never counted as free). Add its price below. Local models are free.</div> : null}
			<div className='flex items-center justify-between gap-3 mt-3'>
				<div className='flex flex-col'>
					<span>Daily limit</span>
					<span className='text-vader-fg-3 text-xs'>When today's estimate reaches the limit a running task pauses and asks before it goes on. A provider that bills more than the list price can still spend more. Empty means no limit.</span>
				</div>
				<div className='flex items-center gap-1'>
					<span className='text-vader-fg-3'>$</span>
					<input className='w-20 px-2 py-0.5 rounded-sm border border-vader-border-2 bg-vader-bg-1 text-vader-fg-1 outline-none' inputMode='decimal' value={limitText} placeholder='none' onChange={e => setLimitText(e.target.value)} onBlur={() => saveLimit(limitText)} onKeyDown={e => { if (e.key === 'Enter') saveLimit(limitText) }} />
				</div>
			</div>
		</div>

		<PricesAndProviderPages />

		<div className='text-vader-fg-3 text-sm mb-2'>Allowed in this project{projectKey ? <span className='font-mono'> ({projectKey})</span> : null}</div>
		{!projectKey ? <div className='text-vader-fg-3 text-xs'>Open a folder to keep approvals for it.</div> : approvals.length === 0 ? <div className='text-vader-fg-3 text-xs'>Nothing yet. When the agent asks to run a command, "Allow in this project" remembers that exact command here. Rules that always ask (keys, installs, sudo) are never skipped.</div> : <div className='flex flex-col gap-y-1'>
			{approvals.map(a => <div key={a.key} className='border border-vader-border-3 rounded p-2 flex items-center justify-between gap-2'>
				<div className='flex flex-col min-w-0'>
					<span className='font-mono text-xs truncate'>{a.label}</span>
					<span className='text-vader-fg-3 text-xs'>{a.kind === 'mcp' ? 'MCP tool' : 'Command'}, allowed {new Date(a.addedAt).toLocaleDateString()}</span>
				</div>
				<VaderButtonBgDarken className='px-2 py-0.5 text-xs shrink-0' onClick={() => { if (projectKey) chatThreadService.revokeProjectApproval(projectKey, a.key) }}>Revoke</VaderButtonBgDarken>
			</div>)}
		</div>}
	</div>
}

export const ModelRouterSection = () => {
	const accessor = useAccessor()
	const modelRouterService = accessor.get('IModelRouterService')
	const routerState = useModelRouterServiceState()
	useSettingsState() // re-render when provider settings change, since that changes what's "configured"

	const configuredModels = modelRouterService.listConfiguredModels()

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Model Router</h2>
		<h4 className={`text-vader-fg-3 mb-4`}>
			Controls which model handles work that isn't the visible Chat/Autocomplete/Apply/SCM features above - subagent delegation, research, browser automation, and context-compaction summarization. In Auto mode, Vader only ever picks from models you've actually configured below (never a provider with no credentials entered), preferring your Chat model unless another configured model is meaningfully better-suited. In Manual mode, these all use your Chat model unless overridden.
		</h4>

		<div className='my-4'>
			<div className='text-vader-fg-3 text-sm mb-1'>Mode</div>
			<div className='flex gap-x-2'>
				{(['auto', 'manual'] as const).map(mode => (
					<VaderButtonBgDarken
						key={mode}
						className={`px-3 py-1 capitalize ${routerState.mode === mode ? 'ring-1 ring-vader-fg-3' : ''}`}
						onClick={() => modelRouterService.setMode(mode)}
					>
						{mode}
					</VaderButtonBgDarken>
				))}
			</div>
		</div>

		<div className='my-4'>
			<div className='text-vader-fg-3 text-sm mb-2'>Per-category model{routerState.mode === 'manual' ? '' : ' (Manual mode only - Auto mode picks automatically, ignoring these)'}</div>
			{configuredModels.length === 0 ? <div className='text-vader-fg-3 text-xs italic'>No models configured yet - add a provider above first.</div> : null}
			<div className='flex flex-col gap-y-1'>
				{ROUTER_CATEGORIES.map(({ category, label, desc }) => {
					const resolved = modelRouterService.resolveModel(category)
					const override = modelRouterService.getCategoryOverride(category)
					const overrideKey = override ? `${override.providerName}/${override.modelName}` : DEFAULT_ROUTER_OPTION
					const options = [DEFAULT_ROUTER_OPTION, ...configuredModels.map(d => `${d.providerName}/${d.modelName}`)]
					return <div key={category} className='flex items-center justify-between text-xs border-b border-vader-border-3 py-1 gap-x-2'>
						<div>
							<div className='font-medium'>{label}</div>
							<div className='text-vader-fg-3'>{desc}</div>
							<div className='text-vader-fg-3'>Currently resolves to: {resolved ? `${resolved.providerName}/${resolved.modelName}` : '(none configured)'}</div>
						</div>
						<VaderCustomDropdownBox
							className='text-xs bg-vader-bg-1 border border-vader-border-2 rounded py-0.5 px-1 shrink-0'
							options={options}
							selectedOption={overrideKey}
							onChangeOption={(val) => {
								if (val === DEFAULT_ROUTER_OPTION) { modelRouterService.setCategoryOverride(category, null); return }
								const [providerName, modelName] = val.split('/')
								modelRouterService.setCategoryOverride(category, { providerName: providerName as ProviderName, modelName })
							}}
							getOptionDisplayName={k => k}
							getOptionDropdownName={k => k}
							getOptionDropdownDetail={() => ''}
							getOptionsEqual={(a, b) => a === b}
						/>
					</div>
				})}
			</div>
		</div>
	</div>
}


const trustBadgeClass = (trustState: string) =>
	trustState === 'trusted' ? 'text-green-600' : trustState === 'blocked' ? 'text-red-500' : 'text-vader-fg-3'

// Vader addition: Skills lifecycle UI - see common/skills/. Installed skills start disabled
// and 'review_required'; this is where a user actually reviews/enables/trusts/removes one -
// without this, install_skill would be a tool with no way to act on what it produced.
export const SkillsSection = () => {
	const accessor = useAccessor()
	const skillService = accessor.get('ISkillService')
	const skills = useSkillsState()
	// what the trust monitor saw the first time it scored each skill; it scores them again from live data every few hours
	const trustHistory = React.useMemo(() => { try { return parseTrustHistory(JSON.parse(accessor.get('IStorageService').get(TRUST_HISTORY_STORAGE_KEY, StorageScope.APPLICATION) ?? 'null')) } catch { return {} } }, [accessor, skills])

	if (skills.length === 0) return <div className='text-vader-fg-3 py-6'>No skills are installed yet. Open Add-ons to find some.</div>

	return <div className='max-w-[760px]'>
		<h4 className={`text-vader-fg-3 mb-4`}>
			Skills you installed from Add-ons, that the main agent found, or that it wrote itself. Every skill starts switched off and marked "review_required": read it before enabling it, and especially before marking it Trusted. When a skill changes at its source, a Trusted skill goes back to review_required, so a silent change can never keep its trusted status.
		</h4>
		<div className='flex flex-col gap-y-2'>
			{skills.map(skill => (
				<div key={skill.id} className='border border-vader-border-3 rounded p-2 flex flex-col gap-y-1'>
					<div className='flex items-center justify-between'>
						<span className='font-medium'>{skill.name}</span>
						<span className='flex items-center gap-3'>
								<span className={`text-xs capitalize ${trustBadgeClass(skill.trustState)}`}>{skill.trustState.replace('_', ' ')}</span>
								<TrustMeter score={computeTrust({ kind: 'skill', name: skill.name, publisher: ownerOfRepository(skill.source.repositoryUrl), instructions: skill.instructions, userTrustState: skill.trustState })} />
							</span>
					</div>
					{(() => { const h = trustHistory['skills:' + skill.id]; return h && h.score !== h.first ? <span className={h.score < h.first ? 'text-yellow-600 text-xs' : 'text-vader-fg-3 text-xs'}>Scored {h.score}% on {new Date(h.at).toLocaleDateString()} from live data; it was {h.first}% the first time. {h.against.length ? 'Against it: ' + h.against.slice(0, 3).join('; ') + '.' : ''}</span> : h ? <span className='text-vader-fg-3 text-xs'>Scored again from live data on {new Date(h.at).toLocaleDateString()}: {h.score}%.</span> : null })()}
					<span className='text-vader-fg-3 text-xs'>{skill.description}</span>
					<span className='text-vader-fg-3 text-xs'>
						Category: {skill.category}
						{skill.requestedCapabilities.terminal || skill.requestedCapabilities.fs || skill.requestedCapabilities.network || skill.requestedCapabilities.mcp ?
							` · Requests: ${[skill.requestedCapabilities.fs && 'filesystem', skill.requestedCapabilities.terminal && 'terminal', skill.requestedCapabilities.network && 'network', skill.requestedCapabilities.mcp && 'MCP'].filter(Boolean).join(', ')}`
							: ''}
					</span>
					<div className='flex gap-x-1 mt-1'>
						<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setEnabled(skill.id, !skill.enabled)}>
							{skill.enabled ? 'Disable' : 'Enable'}
						</VaderButtonBgDarken>
						{skill.trustState !== 'trusted' ?
							<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setTrustState(skill.id, 'trusted')}>Mark Trusted</VaderButtonBgDarken>
							: <VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setTrustState(skill.id, 'review_required')}>Revoke trust</VaderButtonBgDarken>}
						{skill.trustState !== 'blocked' ?
							<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setTrustState(skill.id, 'blocked')}>Block</VaderButtonBgDarken>
							: null}
						<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.setPinned(skill.id, !skill.pinned)}>
							{skill.pinned ? 'Unpin' : 'Pin'}
						</VaderButtonBgDarken>
						<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.remove(skill.id)}>Remove</VaderButtonBgDarken>
					</div>
				</div>
			))}
		</div>
	</div>
}


/** "owner" of a https://github.com/owner/repo address, or undefined */
const ownerOfRepository = (repositoryUrl: string | undefined): string | undefined => {
	try {
		if (!repositoryUrl) return undefined
		const url = new URL(repositoryUrl)
		return url.hostname === 'github.com' ? url.pathname.split('/').filter(Boolean)[0] : undefined
	} catch { return undefined }
}

const TrustLegend = () => <span className='flex items-center gap-4 text-vader-fg-3 text-xs'>
	<span className='flex items-center gap-1.5'><span className='w-2 h-2 rounded-full bg-green-500' />80 to 100 high trust</span>
	<span className='flex items-center gap-1.5'><span className='w-2 h-2 rounded-full bg-yellow-500' />50 to 79 read it first</span>
	<span className='flex items-center gap-1.5'><span className='w-2 h-2 rounded-full bg-red-500' />under 50 risky</span>
</span>

// The places the skills store reads from: the GitHub repositories of skills the user keeps, and SkillNet. A repository is read through
// GitHub's public API (a repository's file list and each SKILL.md); nothing about the workspace is sent.
// Vader addition: where Add-ons looks. Each is a live public source asked with the words typed; one switched off is not asked. Extension and agent
// sources are fixed by the product and shown so the person sees where results come from.
const AddonSourcesSection = ({ kinds }: { kinds: AddonSourceKind[] }) => {
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const off = settingsState.globalSettings.addonSourcesOff ?? []
	const toggle = (id: string, on: boolean) => vaderSettingsService.setGlobalSetting('addonSourcesOff', on ? off.filter(x => x !== id) : [...off.filter(x => x !== id), id])
	return <div className='flex flex-col gap-2 max-w-[760px]' data-testid='vader-addon-sources'>
		<div className='text-vader-fg-3'>Add-ons asks these live sources when you open it or search. A source you switch off is not asked; what you installed from it stays. Only your search words are sent, never anything from your project.</div>
		<div className='flex flex-col'>
			{ADDON_SOURCES.filter(s => kinds.includes(s.kind)).map(s => <div key={s.id} className='flex items-center gap-3 py-2 border-t border-vader-border-3'>
				<div className='flex flex-col min-w-0 flex-1'>
					<span className='text-vader-fg-1'>{s.label}</span>
					<span className='text-vader-fg-3 text-xs'>{s.hint} <span className='font-mono'>{s.host}</span></span>
				</div>
				{s.fixed ? <span className='text-vader-fg-3 text-xs'>Always on</span> : <VaderSwitch size='xs' value={isSourceOn(off, s.id)} onChange={v => toggle(s.id, v)} />}
			</div>)}
		</div>
	</div>
}

const SkillSourcesSection = () => {
	const accessor = useAccessor()
	const skillService = accessor.get('ISkillService')
	useSkillsState() // sources changes fire the same event as skills do
	const sources = skillService.listSources()
	const [text, setText] = useState('')
	const [problem, setProblem] = useState('')
	const add = () => {
		if (!text.trim()) return
		if (skillService.addSource(text)) { setText(''); setProblem('') }
		else setProblem('That is not a GitHub repository. Use owner/repo or an address that starts with https://github.com/.')
	}
	return <div className='flex flex-col gap-6 max-w-[760px]'>
		<AddonSourcesSection kinds={['skill']} />
		<div className='flex flex-col gap-3'>
		<div className='text-vader-fg-1'>GitHub repositories of skills</div>
		<div className='text-vader-fg-3'>Add-ons lists every skill it finds in these repositories (anthropics/skills and openai/skills to begin with). Add your own below.</div>
		<div className='flex flex-col'>
			{sources.length === 0 ? <div className='text-vader-fg-3 py-3'>No repositories yet. Add one below.</div> : null}
			{sources.map(s => <div key={s} className='flex items-center gap-3 py-2 border-t border-vader-border-3'>
				<span className='flex-1 font-mono'>{s}</span>
				<a className='text-vader-fg-3 hover:text-vader-fg-1 underline cursor-pointer' onClick={() => accessor.get('IOpenerService').open(URI.parse(`https://github.com/${s}`))}>Open on GitHub</a>
				<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => skillService.removeSource(s)}>Remove</VaderButtonBgDarken>
			</div>)}
		</div>
		<div className='flex items-center gap-2'>
			<input className='flex-1 px-3 py-1.5 rounded-md border border-vader-border-2 bg-vader-bg-1 text-vader-fg-1 outline-none' placeholder='owner/repo or https://github.com/owner/repo' value={text} onChange={e => { setText(e.target.value); setProblem('') }} onKeyDown={e => { if (e.key === 'Enter') add() }} />
			<VaderButtonBgDarken className='px-3 py-1' onClick={add}>Add repository</VaderButtonBgDarken>
		</div>
		{problem ? <div className='text-red-500'>{problem}</div> : null}
		</div>
	</div>
}

export const SkillsPage = () => {
	const [tab, setTab] = useState<'installed' | 'sources'>('installed')
	const skills = useSkillsState()
	const commandService = useAccessor().get('ICommandService')
	const tabs: { id: typeof tab, label: string }[] = [{ id: 'installed', label: `Installed ${skills.length || ''}`.trim() }, { id: 'sources', label: 'Sources' }]
	return <div className='flex flex-col gap-4' data-testid='vader-settings-skills'>
		<div className='flex items-start gap-4'>
			<div className='flex-1'>
				<h2 className='text-3xl mb-2'>Skills</h2>
				<h4 className='text-vader-fg-3 max-w-[760px]'>The skills this computer has: switch them on and off, read them, update or remove them. A skill is written instructions the agent follows when a task matches. To find new ones, use Add-ons.</h4>
			</div>
			<VaderButtonBgDarken className='px-3 py-1 shrink-0' onClick={() => commandService.executeCommand(VADER_OPEN_ADDONS_ACTION_ID)}>Browse skills in Add-ons</VaderButtonBgDarken>
		</div>
		<div className='flex items-end justify-between border-b border-vader-border-3'>
			<div className='flex'>
				{tabs.map(t => <button key={t.id} className={`px-1 py-2 mr-5 border-b ${tab === t.id ? 'border-vader-fg-1 text-vader-fg-1' : 'border-transparent text-vader-fg-3'}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
			</div>
			<div className='pb-2'><TrustLegend /></div>
		</div>
		{tab === 'installed' ? <SkillsSection /> : null}
		{tab === 'sources' ? <SkillSourcesSection /> : null}
	</div>
}

// Vader addition: Memory UI - see common/memory/. Never exposes hidden model
// reasoning/chain-of-thought, only the stored facts/labels a `remember` call actually wrote.
export const MemorySection = () => {
	const accessor = useAccessor()
	const memoryService = accessor.get('IMemoryService')
	const agentsService = accessor.get('IAgentsService')
	const memoryState = useMemoryState()

	if (memoryState.project.length === 0 && memoryState.agent.length === 0) return null

	const agentNameOf = (agentId: string) => agentsService.getAgent(agentId)?.name ?? '(deleted agent)'

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Memory</h2>
		<h4 className={`text-vader-fg-3 mb-4`}>
			Facts the main agent (or a permanent agent) chose to remember with the `remember` tool. Project memory is visible to every future thread in this workspace; agent memory is visible only to threads running as that agent.
		</h4>

		{memoryState.project.length > 0 ? <div className='my-3'>
			<div className='flex items-center justify-between mb-2'>
				<div className='text-vader-fg-3 text-sm'>Project memory ({memoryState.project.length})</div>
				<VaderButtonBgDarken className='px-2 py-0.5 text-xs' onClick={() => memoryService.clearScope('project')}>Clear all</VaderButtonBgDarken>
			</div>
			<div className='flex flex-col gap-y-2'>
				{memoryState.project.map(m => (
					<div key={m.id} className='border border-vader-border-3 rounded p-2 flex items-start justify-between gap-x-2'>
						<div>
							<div className='font-medium text-sm'>{m.label}</div>
							<div className='text-vader-fg-3 text-xs'>{m.content}</div>
						</div>
						<VaderButtonBgDarken className='px-2 py-0.5 text-xs shrink-0' onClick={() => memoryService.remove(m.id)}>Remove</VaderButtonBgDarken>
					</div>
				))}
			</div>
		</div> : null}

		{memoryState.agent.length > 0 ? <div className='my-3'>
			<div className='text-vader-fg-3 text-sm mb-2'>Agent memory ({memoryState.agent.length})</div>
			<div className='flex flex-col gap-y-2'>
				{memoryState.agent.map(m => (
					<div key={m.id} className='border border-vader-border-3 rounded p-2 flex items-start justify-between gap-x-2'>
						<div>
							<div className='font-medium text-sm'>{m.label} <span className='text-vader-fg-3 font-normal'>({agentNameOf(m.scopeKey)})</span></div>
							<div className='text-vader-fg-3 text-xs'>{m.content}</div>
						</div>
						<VaderButtonBgDarken className='px-2 py-0.5 text-xs shrink-0' onClick={() => memoryService.remove(m.id)}>Remove</VaderButtonBgDarken>
					</div>
				))}
			</div>
		</div> : null}
	</div>
}


// Vader addition: Agent Manager - live visibility into parallel agent orchestration runs
// (see common/orchestration/). A first, functional pass built as a Settings section rather
// than a new dedicated workbench view/pane - the live orchestration state this reads
// (IAgentOrchestrationService.runs) is fully real, not a placeholder; a standalone panel
// with its own activity-bar icon is a larger, separate piece of workbench plumbing tracked
// as further UI work, not silently skipped.
// Vader addition, part of the Cline Main Agent Runtime integration - see
// docs/integrations/agent-runtime.md. Cline is Vader's only Main Agent runtime; this shows its
// real, live health (never a hardcoded "healthy") so a genuine incompatibility is visible here
// instead of only surfacing as a confusing per-task chat error.
const RuntimeStatusBlock = () => {
	const accessor = useAccessor()
	const registry = accessor.get('IAgentRuntimeRegistryService')
	const [health, setHealth] = useState(() => registry.getHealth())

	const healthColor = (status: string) =>
		status === 'initialized' ? 'text-green-600' : status === 'unavailable' || status === 'runtime-error' ? 'text-red-500' : 'text-vader-fg-3'

	return <div className='mb-6'>
		<div className='flex items-center justify-between mb-1'>
			<h3 className='text-lg'>Main Agent Runtime</h3>
			<button
				className='text-xs text-vader-fg-3 hover:text-vader-fg-1 underline'
				onClick={() => { registry.refresh().then(setHealth) }}
			>Refresh</button>
		</div>
		<div className='border border-vader-border-3 rounded p-2 text-xs'>
			<div className='flex items-center justify-between'>
				<span className='font-medium'>Cline Agent Runtime</span>
				<span className={`capitalize ${healthColor(health.status)}`}>{health.status}{health.version ? ` · ${health.version}` : ''}</span>
			</div>
			<div className='text-vader-fg-3 mt-1'>{health.detail}</div>
		</div>
	</div>
}

// Vader addition: a task whose branch conflicts with the current branch. Keep one side where the two differ, or let an agent merge them in the task's worktree.
const ConflictButtons = ({ runId, taskId, files }: { runId: string, taskId: string, files: string[] | undefined }) => {
	const accessor = useAccessor()
	const orchestrationService = accessor.get('IAgentOrchestrationService')
	const [busy, setBusy] = useState<string | null>(null)
	const [problem, setProblem] = useState('')
	const go = async (choice: 'target' | 'branch' | 'agent') => {
		setBusy(choice); setProblem('')
		try { const r = await orchestrationService.resolveConflict(runId, taskId, choice); if (!r.ok) setProblem(r.reason) }
		finally { setBusy(null) }
	}
	return <div className='mt-1 flex flex-col gap-y-1'>
		{files?.length ? <div className='text-vader-fg-3'>Both sides changed: {files.join(', ')}</div> : null}
		<div className='flex flex-wrap gap-x-1'>
			<VaderButtonBgDarken className='px-2 py-0.5 text-xs' disabled={!!busy} onClick={() => go('agent')}>{busy === 'agent' ? 'Merging...' : 'Let an agent merge them'}</VaderButtonBgDarken>
			<VaderButtonBgDarken className='px-2 py-0.5 text-xs' disabled={!!busy} onClick={() => go('target')}>Keep the current version</VaderButtonBgDarken>
			<VaderButtonBgDarken className='px-2 py-0.5 text-xs' disabled={!!busy} onClick={() => go('branch')}>Keep this task's version</VaderButtonBgDarken>
		</div>
		{problem ? <div className='text-red-500'>{problem}</div> : null}
	</div>
}

export const AgentManagerSection = () => {
	const runs = useOrchestrationRunsState()

	const statusColor = (status: string) =>
		status === 'success' ? 'text-green-600' : status === 'error' ? 'text-red-500' : status === 'running' ? 'text-vader-fg-1' : 'text-vader-fg-3'

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Agent Manager</h2>
		<RuntimeStatusBlock />
		{runs.length === 0 ? null : <>
		<h4 className={`text-vader-fg-3 mb-4`}>Parallel agent runs from delegate_parallel_tasks, most recent first. Each task shows its model/agent, status, and - for worktree-isolated tasks - its merge outcome.</h4>
		<div className='flex flex-col gap-y-4'>
			{runs.slice().reverse().map(run => (
				<div key={run.id} className='border border-vader-border-3 rounded p-2'>
					<div className='text-vader-fg-3 text-xs mb-2'>Run started {new Date(run.createdAt).toLocaleTimeString()}{run.cancelled ? ' - cancelled' : ''}{run.finishedAt ? ` - finished ${new Date(run.finishedAt).toLocaleTimeString()}` : ' - in progress'}</div>
					<div className='flex flex-col gap-y-1'>
						{run.tasks.map(t => (
							<div key={t.id} className='text-xs border-t border-vader-border-3 pt-1'>
								<div className='flex items-center justify-between'>
									<span>{t.task.slice(0, 90)}</span>
									<span className={`capitalize ${statusColor(t.status)}`}>{t.status}</span>
								</div>
								<div className='text-vader-fg-3'>
									{t.agentName ? `Agent: ${t.agentName} · ` : ''}
									{t.usesWorktree ? `Worktree${t.branchName ? ` (${t.branchName})` : ''}${t.mergeOutcome ? ` · ${t.mergeOutcome}` : ''}` : 'Direct (no isolation)'}
									{t.changedFilePaths?.length ? ` · ${t.changedFilePaths.length} file(s) changed` : ''}
								</div>
								{t.errorMessage ? <div className='text-red-500'>{t.errorMessage}</div> : null}
									{t.mergeOutcome === 'conflict' ? <ConflictButtons runId={run.id} taskId={t.id} files={t.conflictFiles} /> : null}
							</div>
						))}
					</div>
				</div>
			))}
			</div>
		</>}
	</div>
}


export const VaderProviderSettings = ({ providerNames, searchable }: { providerNames: ProviderName[], searchable?: boolean }) => {
	const [query, setQuery] = useState('')
	const shown = searchable ? filterProviders(providerNames, query) : providerNames
	return <>
		{searchable && <div className='mb-4'>
			<VaderSimpleInputBox value={query} onChangeValue={setQuery} placeholder={`Search ${providerNames.length} providers (for example: together, qwen, kimi, nvidia)`} compact={true} />
		</div>}
		{shown.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} showProviderTitle={true} showProviderSuggestions={true} />
		)}
		{searchable && shown.length === 0 && <div className='text-vader-fg-3 opacity-70'>{`No provider matches "${query}". Any other OpenAI-compatible service can be added with the "OpenAI-Compatible" provider.`}</div>}
	</>
}


type TabName = 'models' | 'general'
export const AutoDetectLocalModelsToggle = () => {
	const settingName: GlobalSettingName = 'autoRefreshModels'

	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const metricsService = accessor.get('IMetricsService')

	const vaderSettingsState = useSettingsState()

	// right now this is just `enabled_autoRefreshModels`
	const enabled = vaderSettingsState.globalSettings[settingName]

	return <ButtonLeftTextRightOption
		leftButton={<VaderSwitch
			size='xxs'
			value={enabled}
			onChange={(newVal) => {
				vaderSettingsService.setGlobalSetting(settingName, newVal)
				metricsService.capture('Click', { action: 'Autorefresh Toggle', settingName, enabled: newVal })
			}}
		/>}
		text={`Automatically detect local providers and models (${refreshableProviderNames.map(providerName => displayInfoOfProviderName(providerName).title).join(', ')}).`}
	/>


}

export const AIInstructionsBox = () => {
	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const vaderSettingsState = useSettingsState()
	return <VaderInputBox2
		className='min-h-[81px] p-3 rounded-sm'
		initValue={vaderSettingsState.globalSettings.aiInstructions}
		placeholder={`Do not change my indentation or delete my comments. When writing TS or JS, do not add ;'s. Write new code using Rust if possible. `}
		multiline
		onChangeText={(newText) => {
			vaderSettingsService.setGlobalSetting('aiInstructions', newText)
		}}
	/>
}

const FastApplyMethodDropdown = () => {
	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')

	const options = useMemo(() => [true, false], [])

	const onChangeOption = useCallback((newVal: boolean) => {
		vaderSettingsService.setGlobalSetting('enableFastApply', newVal)
	}, [vaderSettingsService])

	return <VaderCustomDropdownBox
		className='text-xs text-vader-fg-3 bg-vader-bg-1 border border-vader-border-1 rounded p-0.5 px-1'
		options={options}
		selectedOption={vaderSettingsService.state.globalSettings.enableFastApply}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownDetail={(val) => val ? 'Output Search/Replace blocks' : 'Rewrite whole files'}
		getOptionsEqual={(a, b) => a === b}
	/>

}


export const OllamaSetupInstructions = ({ sayWeAutoDetect }: { sayWeAutoDetect?: boolean }) => {
	return <div className='prose-p:my-0 prose-ol:list-decimal prose-p:py-0 prose-ol:my-0 prose-ol:py-0 prose-span:my-0 prose-span:py-0 text-vader-fg-3 text-sm list-decimal select-text'>
		<div className=''><ChatMarkdownRender string={`Ollama Setup Instructions`} chatMessageLocation={undefined} /></div>
		<div className=' pl-6'><ChatMarkdownRender string={`1. Download [Ollama](https://ollama.com/download).`} chatMessageLocation={undefined} /></div>
		<div className=' pl-6'><ChatMarkdownRender string={`2. Open your terminal.`} chatMessageLocation={undefined} /></div>
		<div
			className='pl-6 flex items-center w-fit'
			data-tooltip-id='vader-tooltip-ollama-settings'
		>
			<ChatMarkdownRender string={`3. Run \`ollama pull your_model\` to install a model.`} chatMessageLocation={undefined} />
		</div>
		{sayWeAutoDetect && <div className=' pl-6'><ChatMarkdownRender string={`Vader automatically detects locally running models and enables them.`} chatMessageLocation={undefined} /></div>}
	</div>
}


const RedoOnboardingButton = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	return <div
		className={`text-vader-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer ${className}`}
		onClick={() => { vaderSettingsService.setGlobalSetting('isOnboardingComplete', false) }}
	>
		See onboarding screen?
	</div>

}







export const ToolApprovalTypeSwitch = ({ approvalType, size, desc }: { approvalType: ToolApprovalType, size: "xxs" | "xs" | "sm" | "sm+" | "md", desc: string }) => {
	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const vaderSettingsState = useSettingsState()
	const metricsService = accessor.get('IMetricsService')

	const onToggleAutoApprove = useCallback((approvalType: ToolApprovalType, newValue: boolean) => {
		vaderSettingsService.setGlobalSetting('autoApprove', {
			...vaderSettingsService.state.globalSettings.autoApprove,
			[approvalType]: newValue
		})
		metricsService.capture('Tool Auto-Accept Toggle', { enabled: newValue })
	}, [vaderSettingsService, metricsService])

	return <>
		<VaderSwitch
			size={size}
			value={vaderSettingsState.globalSettings.autoApprove[approvalType] ?? false}
			onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
		/>
		<span className="text-vader-fg-3 text-xs">{desc}</span>
	</>
}



export const OneClickSwitchButton = ({ fromEditor = 'VS Code', className = '' }: { fromEditor?: TransferEditorType, className?: string }) => {
	const accessor = useAccessor()
	const extensionTransferService = accessor.get('IExtensionTransferService')

	const [transferState, setTransferState] = useState<{ type: 'done', error?: string } | { type: | 'loading' | 'justfinished' }>({ type: 'done' })



	const onClick = async () => {
		if (transferState.type !== 'done') return

		setTransferState({ type: 'loading' })

		const errAcc = await extensionTransferService.transferExtensions(os, fromEditor)

		// Even if some files were missing, consider it a success if no actual errors occurred
		const hadError = !!errAcc
		if (hadError) {
			setTransferState({ type: 'done', error: errAcc })
		}
		else {
			setTransferState({ type: 'justfinished' })
			setTimeout(() => { setTransferState({ type: 'done' }); }, 3000)
		}
	}

	return <>
		<VaderButtonBgDarken className={`p-4 ${className}`} disabled={transferState.type !== 'done'} onClick={onClick}>
			{transferState.type === 'done' ? `Transfer from ${fromEditor}`
				: transferState.type === 'loading' ? <span className='text-nowrap flex flex-nowrap'>Transferring<IconLoading /></span>
					: transferState.type === 'justfinished' ? <AnimatedCheckmarkButton text='Settings Transferred' className='bg-none' />
						: null
			}
		</VaderButtonBgDarken>
		{transferState.type === 'done' && transferState.error ? <WarningBox text={transferState.error} /> : null}
	</>
}


// full settings

// MCP Server component
const MCPServerComponent = ({ name, server }: { name: string, server: MCPServer }) => {
	const accessor = useAccessor();
	const mcpService = accessor.get('IMCPService');

	const vaderSettings = useSettingsState()
	const isOn = vaderSettings.mcpUserStateOfName[name]?.isOn

	const removeUniquePrefix = (name: string) => name.split('_').slice(1).join('_')

	return (
		<div className="border border-vader-border-2 bg-vader-bg-1 py-3 px-4 rounded-sm my-2">
			<div className="flex items-center justify-between">
				{/* Left side - status and name */}
				<div className="flex items-center gap-2">
					{/* Status indicator */}
					<div className={`w-2 h-2 rounded-full
						${server.status === 'success' ? 'bg-green-500'
							: server.status === 'error' ? 'bg-red-500'
								: server.status === 'loading' ? 'bg-yellow-500'
									: server.status === 'offline' ? 'bg-vader-fg-3'
										: ''}
					`}></div>

					{/* Server name */}
					<div className="text-sm font-medium text-vader-fg-1">{name}</div>
				</div>

				{/* Right side - power toggle switch */}
				<VaderSwitch
					value={isOn ?? false}
					size='xs'
					disabled={server.status === 'error'}
					onChange={() => mcpService.toggleServerIsOn(name, !isOn)}
				/>
			</div>

			{/* Tools section */}
			{isOn && (
				<div className="mt-3">
					<div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
						{(server.tools ?? []).length > 0 ? (
							(server.tools ?? []).map((tool: { name: string; description?: string }) => (
								<span
									key={tool.name}
									className="px-2 py-0.5 bg-vader-bg-2 text-vader-fg-3 rounded-sm text-xs"

									data-tooltip-id='vader-tooltip'
									data-tooltip-content={tool.description || ''}
									data-tooltip-class-name='vader-max-w-[300px]'
								>
									{removeUniquePrefix(tool.name)}
								</span>
							))
						) : (
							<span className="text-xs text-vader-fg-3">No tools available</span>
						)}
					</div>
				</div>
			)}

			{/* Command badge */}
			{isOn && server.command && (
				<div className="mt-3">
					<div className="text-xs text-vader-fg-3 mb-1">Command:</div>
					<div className="px-2 py-1 bg-vader-bg-2 text-xs font-mono overflow-x-auto whitespace-nowrap text-vader-fg-2 rounded-sm">
						{server.command}
					</div>
				</div>
			)}

			{/* Error message if present */}
			{server.error && (
				<div className="mt-3">
					<WarningBox text={server.error} />
				</div>
			)}
		</div>
	);
};

// Main component that renders the list of servers
const MCPServersList = () => {
	const mcpServiceState = useMCPServiceState()

	let content: React.ReactNode
	if (mcpServiceState.error) {
		content = <div className="text-vader-fg-3 text-sm mt-2">
			{mcpServiceState.error}
		</div>
	}
	else {
		const entries = Object.entries(mcpServiceState.mcpServerOfName)
		if (entries.length === 0) {
			content = <div className="text-vader-fg-3 text-sm mt-2">
				No servers found
			</div>
		}
		else {
			content = entries.map(([name, server]) => (
				<MCPServerComponent key={name} name={name} server={server} />
			))
		}
	}

	return <div className="my-2">{content}</div>
};

// ─────────────── sections added with the Settings restructure ───────────────

const REPO_URL = 'https://github.com/qwzx4893-stack/Vader'

const SectionTitle = ({ title, desc }: { title: string, desc?: React.ReactNode }) => (
	<>
		<h2 className='text-3xl mb-2'>{title}</h2>
		{desc && <h4 className='text-vader-fg-3 mb-4'>{desc}</h4>}
	</>
)

const InfoRow = ({ label, value, testId }: { label: string, value: React.ReactNode, testId?: string }) => (
	<div className='flex items-baseline gap-4 py-1.5 border-b border-vader-border-2 text-sm' data-testid={testId}>
		<div className='w-40 shrink-0 text-vader-fg-3'>{label}</div>
		<div className='min-w-0 break-words select-text'>{value}</div>
	</div>
)

const SwitchRow = ({ value, onChange, label, detail, testId }: { value: boolean, onChange: (v: boolean) => void, label: string, detail?: string, testId?: string }) => (
	<div className='my-3' data-testid={testId}>
		<div className='flex items-center gap-x-2'>
			<VaderSwitch size='xs' value={value} onChange={onChange} />
			<span className='text-sm'>{label}</span>
		</div>
		{detail && <div className='text-vader-fg-3 text-xs mt-1 max-w-[560px]'>{detail}</div>}
	</div>
)

const chatModeInfo: { mode: ChatMode, name: string, detail: string }[] = [
	{ mode: 'agent', name: 'Agent', detail: 'Edits files, runs commands and uses tools, within your approvals and policy rules.' },
	{ mode: 'plan', name: 'Plan', detail: 'Read-only research that ends in a structured plan you can approve into Agent mode.' },
	{ mode: 'gather', name: 'Gather', detail: 'Reads files and searches the project, but cannot edit anything.' },
	{ mode: 'normal', name: 'Chat', detail: 'Plain conversation with the model, no tools.' },
]

const ChatModeSection = () => {
	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()
	const current = settingsState.globalSettings.chatMode
	return <div data-testid='vader-settings-chatmode'>
		<SectionTitle title='Chat Mode' desc='The mode a chat uses. You can also switch it from the chat box at any time; the choice is remembered.' />
		<div className='grid gap-2' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
			{chatModeInfo.map(({ mode, name, detail }) => (
				<button
					key={mode}
					type='button'
					data-testid={`vader-chatmode-${mode}`}
					aria-pressed={current === mode}
					onClick={() => vaderSettingsService.setGlobalSetting('chatMode', mode)}
					className={`text-left p-3 rounded-md border transition-colors duration-150 ${current === mode ? 'border-[#0e70c0] bg-[#0e70c0]/15' : 'border-vader-border-2 hover:bg-vader-bg-3'}`}
				>
					<div className='text-sm font-medium'>{name}</div>
					<div className='text-xs text-vader-fg-3 mt-1'>{detail}</div>
				</button>
			))}
		</div>
	</div>
}

const ExtensionsSection = () => {
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const openerService = accessor.get('IOpenerService')
	const configurationService = accessor.get('IConfigurationService')
	const productService = accessor.get('IProductService')

	const galleryHost = (() => {
		try { return new URL(productService.extensionsGallery?.serviceUrl ?? '').host } catch { return null }
	})()

	const [verifySignature, setVerifySignature] = useState<boolean>(!!configurationService.getValue('extensions.verifySignature'))
	useEffect(() => {
		const d = configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('extensions.verifySignature')) { setVerifySignature(!!configurationService.getValue('extensions.verifySignature')) }
		})
		return () => d.dispose()
	}, [configurationService])

	return <div data-testid='vader-settings-extensions'>
		<SectionTitle title='Extensions' desc='Vader runs VS Code extensions: themes, languages, formatters, debuggers and more.' />

		<div className='mb-4'>
			<InfoRow label='Marketplace' value={galleryHost ? <span>{galleryHost} (Open VSX, the open extension registry)</span> : 'Not configured'} testId='vader-settings-gallery' />
			<InfoRow label='Not available' value='Extensions that Microsoft publishes only on its own Marketplace (for example Remote-SSH and the C/C++ pack) are not on Open VSX. The guide lists alternatives, or install a .vsix you trust.' />
		</div>

		<div className='flex flex-wrap gap-2 mb-4'>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => commandService.executeCommand('workbench.view.extensions')}>Browse Extensions</VaderButtonBgDarken>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => commandService.executeCommand('workbench.extensions.action.installVSIX')}>Install from VSIX…</VaderButtonBgDarken>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => openerService.open(URI.parse(`${REPO_URL}/blob/main/docs/EXTENSIONS.md`))}>Extensions guide</VaderButtonBgDarken>
		</div>

		<SwitchRow
			testId='vader-settings-verify-signature'
			value={verifySignature}
			onChange={(v) => configurationService.updateValue('extensions.verifySignature', v)}
			label='Require signed extensions'
			detail='Off by default: Open VSX does not sign extensions with the Microsoft certificate chain this check needs, so turning it on makes extensions from Open VSX fail to install.'
		/>
	</div>
}

const PrivacySection = () => {
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const openerService = accessor.get('IOpenerService')
	const autoCheckUpdates = settingsState.globalSettings.autoCheckUpdates

	const contacts: { who: string, when: string, host: string }[] = [
		{ who: 'Your model provider', when: 'Only when you chat or fetch the model list with a key you set. Your code goes to that provider and nowhere else.', host: 'the provider you configure (or localhost for local models)' },
		{ who: 'Extension registry', when: 'When you browse, search or install extensions.', host: 'open-vsx.org' },
		{ who: 'Add-ons lists', when: 'When you open Add-ons, or search there, and when the agent searches for a skill or a server. Only the search words are sent, or a GitHub repository\'s public file list and its SKILL.md files. Nothing from your project is sent.', host: 'api.github.com, raw.githubusercontent.com, registry.modelcontextprotocol.io, skills.sh, registry.smithery.ai, registry.npmjs.org, api-skillnet.openkg.cn' },
		{ who: 'Release check', when: autoCheckUpdates ? 'Now on: a quiet check for a newer Vader release every few hours, plus the manual button.' : 'Only when you press "Check for Updates". The background check is off.', host: 'api.github.com' },
		{ who: 'Coding agents you add', when: 'Only after you pick one in Settings > Coding Agents and press Download or Install, or send it a message. The vendor\'s own program then talks to the vendor with your account; Vader does not see the sign-in.', host: 'the vendor of that agent (npm registry, github.com, downloads.cursor.com, dl.google.com for downloads)' },
		{ who: 'Pages the agent opens', when: 'Only when the agent uses its browser tool, and only the sites it was told to visit.', host: 'the sites in question' },
	]

	return <div data-testid='vader-settings-privacy'>
		<SectionTitle title='Privacy & Network' desc='What Vader sends over the network, and to whom. Nothing else is contacted at start-up.' />

		<div className='mb-6'>
			<InfoRow label='Usage metrics' value='None. Vader has no analytics endpoint, no crash reporter and no account.' />
			<InfoRow label='API keys' value='Stored on this computer and only sent to the provider they belong to.' />
			<InfoRow label='Your code and chats' value='Stay on this computer except for what is sent to the model you chose.' />
		</div>

		<h3 className='text-xl mb-2'>Who Vader can contact</h3>
		<div className='mb-6' data-testid='vader-settings-contacts'>
			{contacts.map(c => (
				<div key={c.who} className='py-2 border-b border-vader-border-2 text-sm'>
					<div className='flex justify-between gap-4'><span className='font-medium'>{c.who}</span><span className='text-vader-fg-3 text-xs'>{c.host}</span></div>
					<div className='text-vader-fg-3 text-xs mt-0.5'>{c.when}</div>
				</div>
			))}
		</div>

		<SwitchRow
			testId='vader-settings-privacy-autocheck'
			value={autoCheckUpdates}
			onChange={(v) => vaderSettingsService.setGlobalSetting('autoCheckUpdates', v)}
			label='Check for new releases automatically'
			detail='Looks at the public list of Vader releases on GitHub; sends no information about you. Off by default.'
		/>

		<div className='mt-4'>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => openerService.open(URI.parse(`${REPO_URL}/blob/main/docs/integrations/privacy.md`))}>How this is verified</VaderButtonBgDarken>
		</div>
	</div>
}

const AboutSection = () => {
	const accessor = useAccessor()
	const productService = accessor.get('IProductService')
	const commandService = accessor.get('ICommandService')
	const openerService = accessor.get('IOpenerService')
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()
	const open = (url: string) => openerService.open(URI.parse(url))

	return <div data-testid='vader-settings-about'>
		<SectionTitle title='About & Updates' />
		<div className='mb-6'>
			<InfoRow label='Vader' value={productService.vaderVersion ?? 'unknown'} testId='vader-settings-version' />
			<InfoRow label='Editor base' value={`VS Code ${productService.version}`} />
			<InfoRow label='Commit' value={productService.commit ? productService.commit.slice(0, 10) : 'development build'} />
			<InfoRow label='Built' value={productService.date ? new Date(productService.date).toLocaleString() : 'n/a'} />
			<InfoRow label='License' value='Apache-2.0 (Vader), MIT (VS Code), see the links below' />
		</div>

		<h3 className='text-xl mb-2'>Updates</h3>
		<div className='text-vader-fg-3 text-sm mb-2'>Vader does not update itself. It can tell you when a newer release is on GitHub; you download and install it.</div>
		<div className='flex flex-wrap gap-2 mb-2'>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => commandService.executeCommand('vader.vaderCheckUpdate')}>Check for Updates</VaderButtonBgDarken>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => open(`${REPO_URL}/releases`)}>All releases</VaderButtonBgDarken>
		</div>
		<SwitchRow
			testId='vader-settings-about-autocheck'
			value={settingsState.globalSettings.autoCheckUpdates}
			onChange={(v) => vaderSettingsService.setGlobalSetting('autoCheckUpdates', v)}
			label='Check for new releases automatically'
			detail='Off by default. When on, Vader looks at GitHub shortly after start and then every few hours.'
		/>

		<h3 className='text-xl mt-6 mb-2'>Links</h3>
		<div className='flex flex-wrap gap-2 mb-6'>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => open(REPO_URL)}>GitHub</VaderButtonBgDarken>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => open(`${REPO_URL}/issues`)}>Report an issue</VaderButtonBgDarken>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => open(`${REPO_URL}/blob/main/LICENSE.txt`)}>License</VaderButtonBgDarken>
			<VaderButtonBgDarken className='px-4 py-1' onClick={() => open(`${REPO_URL}/blob/main/ThirdPartyNotices.txt`)}>Third-party notices</VaderButtonBgDarken>
		</div>

		<h3 className='text-xl mb-2'>Credits</h3>
		<div className='text-vader-fg-3 text-sm max-w-[600px]'>
			Built on the open-source VS Code workbench (Microsoft, MIT), on Void by Glass Devtools, Inc. (Apache-2.0), and it runs its agent on the Cline SDK (Apache-2.0).
		</div>
	</div>
}

export const Settings = () => {
	const isDark = useIsDark()
	// ─── sidebar nav ──────────────────────────
	const [selectedSection, setSelectedSection] =
		useState<Tab>('models');

	const mainRef = useRef<HTMLElement>(null)
	const navGroups: { title: string | null; items: { tab: Tab; label: string; Icon: typeof Brain }[] }[] = [
		{ title: 'Models', items: [
			{ tab: 'models', label: 'Models', Icon: Brain },
			{ tab: 'externalAgents', label: 'Connected agents', Icon: Terminal },
			{ tab: 'localProviders', label: 'Local Providers', Icon: HardDrive },
			{ tab: 'providers', label: 'Main Providers', Icon: Cloud },
		] },
		{ title: 'Agent', items: [
			{ tab: 'agent', label: 'Permissions and saved agents', Icon: Bot },
			{ tab: 'context', label: 'Context & Instructions', Icon: BookOpen },
			{ tab: 'skills', label: 'Skills', Icon: Sparkles },
			{ tab: 'mcp', label: 'MCP', Icon: Plug },
			{ tab: 'featureOptions', label: 'Editor Features', Icon: SlidersHorizontal },
		] },
		{ title: 'Workspace', items: [
			{ tab: 'extensions', label: 'Extensions', Icon: Puzzle },
			{ tab: 'privacy', label: 'Privacy & Network', Icon: ShieldCheck },
			{ tab: 'data', label: 'Data & Backup', Icon: Database },
			{ tab: 'about', label: 'About & Updates', Icon: Info },
		] },
		{ title: null, items: [
			{ tab: 'all', label: 'All Settings', Icon: List },
		] },
	];
	const [navQuery, setNavQuery] = useState('')
	// words people look for, besides the page's own name
	const navKeywords: { [tab in Tab]?: string } = {
		models: 'model provider key api openai anthropic gemini openrouter ollama autocomplete apply commit',
		externalAgents: 'coding agent codex copilot cursor opencode claude acp',
		localProviders: 'ollama lm studio vllm local',
		providers: 'cloud provider key',
		agent: 'approve permission safe balanced autonomous spend cost limit budget approval project agent',
		context: 'instructions rules memory agents.md',
		skills: 'skill store install trust sources github skillnet',
		mcp: 'mcp server tools registry',
		featureOptions: 'autocomplete editor quick edit apply fast',
		extensions: 'extension marketplace open vsx vsix',
		privacy: 'privacy network telemetry contact',
		data: 'export import backup chats switch editor',
		about: 'update version release licence credits',
	}
	const navNeedle = navQuery.trim().toLowerCase()
	const shownNavGroups = navNeedle ? navGroups.map(g => ({ ...g, items: g.items.filter(it => it.tab !== 'all' && (it.label + ' ' + (navKeywords[it.tab] ?? '')).toLowerCase().includes(navNeedle)) })).filter(g => g.items.length > 0) : navGroups
	const shouldShowTab = (tab: Tab) => selectedSection === 'all' || selectedSection === tab;
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')
	const settingsState = useSettingsState()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const notificationService = accessor.get('INotificationService')
	const mcpService = accessor.get('IMCPService')

	const onDownload = (t: 'Chats' | 'Settings') => {
		let dataStr: string
		let downloadName: string
		if (t === 'Chats') {
			// Export chat threads
			dataStr = JSON.stringify(chatThreadsService.state, null, 2)
			downloadName = 'vader-chats.json'
		}
		else if (t === 'Settings') {
			// Export user settings
			// API keys and custom headers are left out: the file is made to be shared (bug reports, a colleague's computer)
			dataStr = JSON.stringify(redactSettingsForExport(vaderSettingsService.state), null, 2)
			downloadName = 'vader-settings.json'
		}
		else {
			dataStr = ''
			downloadName = ''
		}

		const blob = new Blob([dataStr], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = downloadName
		a.click()
		URL.revokeObjectURL(url)
	}


	// Add file input refs
	const fileInputSettingsRef = useRef<HTMLInputElement>(null)
	const fileInputChatsRef = useRef<HTMLInputElement>(null)

	const [s, ss] = useState(0)

	const handleUpload = (t: 'Chats' | 'Settings') => (e: React.ChangeEvent<HTMLInputElement>,) => {
		const files = e.target.files
		if (!files) return;
		const file = files[0]
		if (!file) return

		const reader = new FileReader();
		reader.onload = () => {
			try {
				const json = JSON.parse(reader.result as string);

				if (t === 'Chats') {
					chatThreadsService.dangerousSetState(json as any)
				}
				else if (t === 'Settings') {
					// keys already on this computer stay for providers whose endpoint is unchanged; a file can never move them to another server
					vaderSettingsService.dangerousSetState(mergeImportedSettings(json, vaderSettingsService.state as any) as any)
				}

				notificationService.info(`${t} imported successfully!`)
			} catch (err) {
				notificationService.notify({ message: `Failed to import ${t}`, source: err + '', severity: Severity.Error, })
			}
		};
		reader.readAsText(file);
		e.target.value = '';

		ss(s => s + 1)
	}


	return (
		<div className={`@@vader-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%', display: 'flex' }} data-testid='vader-settings-page'>
			{/* ──────────────  SIDEBAR  ────────────── */}
			<aside className='w-60 shrink-0 h-full flex flex-col border-r border-vader-border-2 bg-vader-bg-2 py-4 px-3 select-none'>
				<input data-testid='vader-settings-search' className='mb-3 w-full px-3 py-1.5 rounded-md border border-vader-border-2 bg-vader-bg-1 text-vader-fg-1 text-sm outline-none select-text' placeholder='Search settings' value={navQuery} onChange={e => setNavQuery(e.target.value)} />
				{navNeedle && shownNavGroups.length === 0 ? <div className='px-3 text-vader-fg-3 text-sm'>Nothing in Settings matches that.</div> : null}
				<nav className='flex flex-col gap-1 flex-1 overflow-y-auto' aria-label='Settings sections'>
					{shownNavGroups.map((group, gi) => (
						<div key={gi} className='flex flex-col gap-1'>
							{group.title && <div className={`px-3 ${gi === 0 ? '' : 'mt-3'} mb-0.5 text-[10px] uppercase tracking-wider text-vader-fg-3`}>{group.title}</div>}
							{!group.title && <div className='h-px bg-vader-border-2 my-2 mx-1' />}
							{group.items.map(({ tab, label, Icon }) => (
								<button
									key={tab}
									data-testid={`vader-settings-nav-${tab}`}
									onClick={() => {
										setSelectedSection(tab);
										if (tab === 'all') { mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }
									}}
									className={`flex items-center gap-3 py-2 px-3 rounded-md text-left text-sm transition-colors duration-150
										${selectedSection === tab ? 'bg-[#0e70c0]/80 text-white font-medium' : 'text-vader-fg-1 hover:bg-vader-bg-3'}`}
								>
									<Icon size={16} className='shrink-0 opacity-90' />
									{label}
								</button>
							))}
						</div>
					))}
				</nav>
				<ErrorBoundary>
					<RedoOnboardingButton className='text-xs px-3 pt-3' />
				</ErrorBoundary>
			</aside>

			{/* ───────────── MAIN PANE ───────────── */}
			<main ref={mainRef} className='flex-1 h-full overflow-y-auto select-none'>
				<div className={`${selectedSection === 'skills' || selectedSection === 'mcp' ? 'max-w-6xl' : 'max-w-3xl'} mx-auto px-10 py-8 mb-24`}>

						{/* All sections in flex container with gap-12 */}
						<div className='flex flex-col gap-12'>
							{/* Models section (formerly FeaturesTab) */}
							<div className={shouldShowTab('models') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>Models</h2>
									<ModelDump />
									<div className='w-full h-[1px] my-4' />
									<AutoDetectLocalModelsToggle />
									<RefreshableModels />
								</ErrorBoundary>
							</div>

							{/* Coding agents the person already has an account with */}
							<div className={shouldShowTab('externalAgents') ? `` : 'hidden'}>
								<ErrorBoundary>
									<ExternalAgentsSection />
								</ErrorBoundary>
							</div>

							{/* Local Providers section */}
							<div className={shouldShowTab('localProviders') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>Local Providers</h2>
									<h3 className={`text-vader-fg-3 mb-2`}>{`Vader can access any model that you host locally. We automatically detect your local models by default.`}</h3>

									<div className='opacity-80 mb-4'>
										<OllamaSetupInstructions sayWeAutoDetect={true} />
									</div>

									<VaderProviderSettings providerNames={localProviderNames} />
								</ErrorBoundary>
							</div>

							{/* Main Providers section */}
							<div className={shouldShowTab('providers') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>Main Providers</h2>
									<h3 className={`text-vader-fg-3 mb-2`}>{`Vader connects directly to the model vendors and inference platforms below with your own key: Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral, Qwen, Kimi, Together, Fireworks, NVIDIA and many more. Use the search box to find one.`}</h3>

									<VaderProviderSettings providerNames={nonlocalProviderNames} searchable={true} />
								</ErrorBoundary>
							</div>

							{/* Feature Options section */}
							<div className={shouldShowTab('featureOptions') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className={`text-3xl mb-2`}>Editor Features</h2>

									<div className='flex flex-col gap-y-8 my-4'>
										<ErrorBoundary>
											{/* FIM */}
											<div>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('Autocomplete')}</h4>
												<div className='text-sm text-vader-fg-3 mt-1'>
													<span>
														Experimental.{' '}
													</span>
													<span
														className='hover:brightness-110'
														data-tooltip-id='vader-tooltip'
														data-tooltip-content='We recommend using the largest qwen2.5-coder model you can with Ollama (try qwen2.5-coder:3b).'
														data-tooltip-class-name='vader-max-w-[20px]'
													>
														Only works with FIM models.*
													</span>
												</div>

												<div className='my-2'>
													{/* Enable Switch */}
													<ErrorBoundary>
														<div className='flex items-center gap-x-2 my-2'>
															<VaderSwitch
																size='xs'
																value={settingsState.globalSettings.enableAutocomplete}
																onChange={(newVal) => vaderSettingsService.setGlobalSetting('enableAutocomplete', newVal)}
															/>
															<span className='text-vader-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.enableAutocomplete ? 'Enabled' : 'Disabled'}</span>
														</div>
													</ErrorBoundary>

													{/* Model Dropdown */}
													<ErrorBoundary>
														<div className={`my-2 ${!settingsState.globalSettings.enableAutocomplete ? 'hidden' : ''}`}>
															<ModelDropdown featureName={'Autocomplete'} className='text-xs text-vader-fg-3 bg-vader-bg-1 border border-vader-border-1 rounded p-0.5 px-1' />
														</div>
													</ErrorBoundary>

												</div>

											</div>
										</ErrorBoundary>

										{/* Apply */}
										<ErrorBoundary>

											<div className='w-full'>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('Apply')}</h4>
												<div className='text-sm text-vader-fg-3 mt-1'>Settings that control the behavior of the Apply button.</div>

												<div className='my-2'>
													{/* Sync to Chat Switch */}
													<div className='flex items-center gap-x-2 my-2'>
														<VaderSwitch
															size='xs'
															value={settingsState.globalSettings.syncApplyToChat}
															onChange={(newVal) => vaderSettingsService.setGlobalSetting('syncApplyToChat', newVal)}
														/>
														<span className='text-vader-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.syncApplyToChat ? 'Same as Chat model' : 'Different model'}</span>
													</div>

													{/* Model Dropdown */}
													<div className={`my-2 ${settingsState.globalSettings.syncApplyToChat ? 'hidden' : ''}`}>
														<ModelDropdown featureName={'Apply'} className='text-xs text-vader-fg-3 bg-vader-bg-1 border border-vader-border-1 rounded p-0.5 px-1' />
													</div>
												</div>


												<div className='my-2'>
													{/* Fast Apply Method Dropdown */}
													<div className='flex items-center gap-x-2 my-2'>
														<FastApplyMethodDropdown />
													</div>
												</div>

											</div>
										</ErrorBoundary>




										<div className='w-full'>
											<h4 className={`text-base`}>Editor</h4>
											<div className='text-sm text-vader-fg-3 mt-1'>{`Settings that control the visibility of Vader suggestions in the code editor.`}</div>

											<div className='my-2'>
												{/* Auto Accept Switch */}
												<ErrorBoundary>
													<div className='flex items-center gap-x-2 my-2'>
														<VaderSwitch
															size='xs'
															value={settingsState.globalSettings.showInlineSuggestions}
															onChange={(newVal) => vaderSettingsService.setGlobalSetting('showInlineSuggestions', newVal)}
														/>
														<span className='text-vader-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.showInlineSuggestions ? 'Show suggestions on select' : 'Show suggestions on select'}</span>
													</div>
												</ErrorBoundary>
											</div>
										</div>

										{/* SCM */}
										<ErrorBoundary>

											<div className='w-full'>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('SCM')}</h4>
												<div className='text-sm text-vader-fg-3 mt-1'>Settings that control the behavior of the commit message generator.</div>

												<div className='my-2'>
													{/* Sync to Chat Switch */}
													<div className='flex items-center gap-x-2 my-2'>
														<VaderSwitch
															size='xs'
															value={settingsState.globalSettings.syncSCMToChat}
															onChange={(newVal) => vaderSettingsService.setGlobalSetting('syncSCMToChat', newVal)}
														/>
														<span className='text-vader-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.syncSCMToChat ? 'Same as Chat model' : 'Different model'}</span>
													</div>

													{/* Model Dropdown */}
													<div className={`my-2 ${settingsState.globalSettings.syncSCMToChat ? 'hidden' : ''}`}>
														<ModelDropdown featureName={'SCM'} className='text-xs text-vader-fg-3 bg-vader-bg-1 border border-vader-border-1 rounded p-0.5 px-1' />
													</div>
												</div>

											</div>
										</ErrorBoundary>
									</div>
								</ErrorBoundary>
							</div>

							{/* Agent & Permissions */}
							<div className={`${shouldShowTab('agent') ? `` : 'hidden'} flex flex-col gap-12`}>
								<ErrorBoundary><ChatModeSection /></ErrorBoundary>
								<div>
									<h2 className='text-3xl mb-2'>Tools & Approvals</h2>
									{/* Tools Section */}
										<div>
											
											<div className='text-sm text-vader-fg-3 mt-1'>{`Tools are functions that LLMs can call. Some tools require user approval.`}</div>

											<div className='my-2'>
												{/* Auto Accept Switch */}
												<ErrorBoundary>
													{[...toolApprovalTypes].map((approvalType) => {
														return <div key={approvalType} className="flex items-center gap-x-2 my-2">
															<ToolApprovalTypeSwitch size='xs' approvalType={approvalType} desc={`Auto-approve ${approvalType}`} />
														</div>
													})}

												</ErrorBoundary>

												{/* Tool Lint Errors Switch */}
												<ErrorBoundary>

													<div className='flex items-center gap-x-2 my-2'>
														<VaderSwitch
															size='xs'
															value={settingsState.globalSettings.includeToolLintErrors}
															onChange={(newVal) => vaderSettingsService.setGlobalSetting('includeToolLintErrors', newVal)}
														/>
														<span className='text-vader-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.includeToolLintErrors ? 'Fix lint errors' : `Fix lint errors`}</span>
													</div>
												</ErrorBoundary>

												{/* Auto Accept LLM Changes Switch */}
												<ErrorBoundary>
													<div className='flex items-center gap-x-2 my-2'>
														<VaderSwitch
															size='xs'
															value={settingsState.globalSettings.autoAcceptLLMChanges}
															onChange={(newVal) => vaderSettingsService.setGlobalSetting('autoAcceptLLMChanges', newVal)}
														/>
														<span className='text-vader-fg-3 text-xs pointer-events-none'>Auto-accept LLM changes</span>
													</div>
												</ErrorBoundary>
											</div>
										</div>



										
								</div>
								<AgentsAndPolicySection />
								<SpendingAndProjectSection />
								<ModelRouterSection />
								<AgentManagerSection />
							</div>

							{/* Context & Instructions */}
							<div className={`${shouldShowTab('context') ? `` : 'hidden'} flex flex-col gap-12`}>
								{/* AI Instructions section */}
								<div className='max-w-[600px]'>
									<h2 className={`text-3xl mb-2`}>AI Instructions</h2>
									<h4 className={`text-vader-fg-3 mb-4`}>
										<ChatMarkdownRender inPTag={true} string={`
System instructions to include with all AI requests.
Alternatively, place a \`.vaderrules\` file in the root of your workspace.
								`} chatMessageLocation={undefined} />
									</h4>
									<ErrorBoundary>
										<AIInstructionsBox />
									</ErrorBoundary>
									{/* --- Disable System Message Toggle --- */}
									<div className='my-4'>
										<ErrorBoundary>
											<div className='flex items-center gap-x-2'>
												<VaderSwitch
													size='xs'
													value={!!settingsState.globalSettings.disableSystemMessage}
													onChange={(newValue) => {
														vaderSettingsService.setGlobalSetting('disableSystemMessage', newValue);
													}}
												/>
												<span className='text-vader-fg-3 text-xs pointer-events-none'>
													{'Disable system message'}
												</span>
											</div>
										</ErrorBoundary>
										<div className='text-vader-fg-3 text-xs mt-1'>
											{`When disabled, Vader will not include anything in the system message except for content you specified above.`}
										</div>
									</div>
								</div>

							
								<MemorySection />
							</div>

							{/* Skills */}
							<div className={shouldShowTab('skills') ? `` : 'hidden'}>
								<ErrorBoundary><SkillsPage /></ErrorBoundary>
							</div>

							{/* Extensions */}
							<div className={shouldShowTab('extensions') ? `` : 'hidden'}>
								<ErrorBoundary><ExtensionsSection /></ErrorBoundary>
							</div>

							{/* Privacy & Network */}
							<div className={shouldShowTab('privacy') ? `` : 'hidden'}>
								<ErrorBoundary><PrivacySection /></ErrorBoundary>
							</div>

							{/* Data & Backup */}
							<div className={`${shouldShowTab('data') ? `` : 'hidden'} flex flex-col gap-12`}>
								{/* One-Click Switch section */}
								<div>
									<ErrorBoundary>
										<h2 className='text-3xl mb-2'>One-Click Switch</h2>
										<h4 className='text-vader-fg-3 mb-4'>{`Transfer your editor settings into Vader.`}</h4>

										<div className='flex flex-col gap-2'>
											{transferEditorTypes.map(editor => <OneClickSwitchButton key={editor} className='w-64' fromEditor={editor} />)}
										</div>
									</ErrorBoundary>
								</div>

								
								{/* Import/Export section */}
								<div>
									<h2 className='text-3xl mb-2'>Import/Export</h2>
									<h4 className='text-vader-fg-3 mb-4'>{`Transfer Vader's settings and chats in and out of Vader.`}</h4>
									<div className='flex flex-col gap-8'>
										{/* Settings Subcategory */}
										<div className='flex flex-col gap-2 max-w-48 w-full'>
											<input key={2 * s} ref={fileInputSettingsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Settings')} />
											<VaderButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputSettingsRef.current?.click() }}>
												Import Settings
											</VaderButtonBgDarken>
											<VaderButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Settings')}>
												Export Settings
											</VaderButtonBgDarken>
											<div className='text-vader-fg-3 text-xs'>API keys are not written to the file.</div>
											<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { vaderSettingsService.resetState(); }}>
												Reset Settings
											</ConfirmButton>
										</div>

										{/* Chats Subcategory */}
										<div className='flex flex-col gap-2 max-w-48 w-full'>
											<input key={2 * s + 1} ref={fileInputChatsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Chats')} />
											<VaderButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputChatsRef.current?.click() }}>
												Import Chats
											</VaderButtonBgDarken>
											<VaderButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Chats')}>
												Export Chats
											</VaderButtonBgDarken>
											<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { chatThreadsService.resetState(); }}>
												Reset Chats
											</ConfirmButton>
										</div>
									</div>
								</div>



								
								{/* Built-in Settings section */}
								<div>
									<h2 className={`text-3xl mb-2`}>Built-in Settings</h2>
									<h4 className={`text-vader-fg-3 mb-4`}>{`IDE settings, keyboard settings, and theme customization.`}</h4>

									<ErrorBoundary>
										<div className='flex flex-col gap-2 justify-center max-w-48 w-full'>
											<VaderButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openSettings') }}>
												General Settings
											</VaderButtonBgDarken>
											<VaderButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openGlobalKeybindings') }}>
												Keyboard Settings
											</VaderButtonBgDarken>
											<VaderButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.selectTheme') }}>
												Theme Settings
											</VaderButtonBgDarken>
											<VaderButtonBgDarken className='px-4 py-1' onClick={() => { nativeHostService.showItemInFolder(environmentService.logsHome.fsPath) }}>
												Open Logs
											</VaderButtonBgDarken>
										</div>
									</ErrorBoundary>
								</div>


								
							</div>

							{/* About & Updates */}
							<div className={shouldShowTab('about') ? `` : 'hidden'}>
								<ErrorBoundary><AboutSection /></ErrorBoundary>
							</div>

							{/* MCP section */}
							<div className={shouldShowTab('mcp') ? `` : 'hidden'}>
								<ErrorBoundary>
									<h2 className='text-3xl mb-2'>MCP</h2>
									<h4 className={`text-vader-fg-3 mb-4`}>
										<ChatMarkdownRender inPTag={true} string={`
Use Model Context Protocol to provide Agent mode with more tools.
							`} chatMessageLocation={undefined} />
									</h4>
									<div className='my-2'>
										<VaderButtonBgDarken className='px-4 py-1 w-full max-w-48' onClick={async () => { await mcpService.revealMCPConfigFile() }}>
											Add MCP Server
										</VaderButtonBgDarken>
									</div>

									<ErrorBoundary>
										<MCPServersList />
									</ErrorBoundary>
									<div className='mt-10'>
										<h3 className='text-xl mb-1'>Find more servers</h3>
										<div className='mb-4'><AddonSourcesSection kinds={['mcp']} /></div>
										<h4 className='text-vader-fg-3 mb-3 max-w-[760px]'>Servers from the official MCP Registry are in Add-ons, with a trust score and the reasons for it. Adding one writes its entry to your MCP config file, after asking for any key it needs.</h4>
										<VaderButtonBgDarken className='px-3 py-1' onClick={() => commandService.executeCommand(VADER_OPEN_ADDONS_ACTION_ID)}>Find servers in Add-ons</VaderButtonBgDarken>
									</div>
								</ErrorBoundary>
							</div>





					</div>

				</div>
			</main>
		</div>
	);
}
