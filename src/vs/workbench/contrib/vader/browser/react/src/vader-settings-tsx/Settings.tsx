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
import { X, RefreshCw, Loader2, Check, Asterisk, Plus, Brain, HardDrive, Cloud, SlidersHorizontal, Plug, List, Bot, BookOpen, Puzzle, ShieldCheck, Database, Info } from 'lucide-react'
import { URI } from '../../../../../../../base/common/uri.js'
import { ModelDropdown } from './ModelDropdown.js'
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

type Tab =
	| 'models'
	| 'localProviders'
	| 'providers'
	| 'agent'
	| 'context'
	| 'featureOptions'
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
		// providers without a list route keep their catalogue; say so instead of implying the list is live
		if (providerName === 'ollama' || providerName === 'vLLM' || providerName === 'lmStudio') return null // local servers are detected
		return <div className='py-1 px-3 text-sm opacity-70' data-testid='vader-no-live-list'>
			{providerName === 'openAICompatible' ? 'This endpoint has no model catalogue here: add the models it serves with "Add model".'
				: 'This provider has no model-list API Vader can ask, so the models shown are its catalogue; add any other model by name with "Add model".'}
		</div>
	}
	const st = cloudState[providerName]
	if (st.status === 'idle') return null

	return <div className='py-1 px-3 text-sm flex items-center gap-2' data-testid='vader-cloud-models-status' data-status={st.status}>
		{st.status === 'loading' && <><Loader2 className='size-3 animate-spin' /><span className='opacity-70'>Checking the key with the provider...</span></>}
		{st.status === 'ok' && <><Check className='size-3 text-green-500' /><span className='opacity-80'>Key works - {st.count} model{st.count === 1 ? '' : 's'} available to you.</span></>}
		{st.status === 'error' && <>
			<X className='size-3 text-red-500' />
			<span className='opacity-80'>{st.message}{st.reason === 'unauthorized' ? '' : ' No models are listed until the provider answers; you can still add a model by name.'}</span>
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

// Vader addition: AUTO/MANUAL Model Router. See common/modelRouter/.
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

	if (skills.length === 0) return null

	return <div className='max-w-[600px]'>
		<h2 className={`text-3xl mb-2`}>Skills</h2>
		<h4 className={`text-vader-fg-3 mb-4`}>
			Skills the main agent discovered (via SkillNet) and installed, or wrote itself. Every skill starts disabled and marked "review_required" - read it before enabling, and especially before marking it Trusted. An update to a skill's source content automatically downgrades a Trusted skill back to review_required, so a silent external change can never keep trusted status without you seeing it again.
		</h4>
		<div className='flex flex-col gap-y-2'>
			{skills.map(skill => (
				<div key={skill.id} className='border border-vader-border-3 rounded p-2 flex flex-col gap-y-1'>
					<div className='flex items-center justify-between'>
						<span className='font-medium'>{skill.name}</span>
						<span className={`text-xs capitalize ${trustBadgeClass(skill.trustState)}`}>{skill.trustState.replace('_', ' ')}</span>
					</div>
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
		{ who: 'Release check', when: autoCheckUpdates ? 'Now on: a quiet check for a newer Vader release every few hours, plus the manual button.' : 'Only when you press "Check for Updates". The background check is off.', host: 'api.github.com' },
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
			{ tab: 'localProviders', label: 'Local Providers', Icon: HardDrive },
			{ tab: 'providers', label: 'Main Providers', Icon: Cloud },
		] },
		{ title: 'Agent', items: [
			{ tab: 'agent', label: 'Agent & Permissions', Icon: Bot },
			{ tab: 'context', label: 'Context & Instructions', Icon: BookOpen },
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
			dataStr = JSON.stringify(vaderSettingsService.state, null, 2)
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
					vaderSettingsService.dangerousSetState(json as any)
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
				<nav className='flex flex-col gap-1 flex-1 overflow-y-auto' aria-label='Settings sections'>
					{navGroups.map((group, gi) => (
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
				<div className='max-w-3xl mx-auto px-10 py-8 mb-24'>

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

							
								<SkillsSection />
								<MemorySection />
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
								</ErrorBoundary>
							</div>





					</div>

				</div>
			</main>
		</div>
	);
}
