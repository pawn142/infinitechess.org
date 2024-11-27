
// Import Start
import guipause from '../gui/guipause.js';
import legalmoves from '../../chess/logic/legalmoves.js';
import input from '../input.js';
import onlinegame from '../misc/onlinegame.js';
import movepiece from '../../chess/logic/movepiece.js';
import gamefileutility from '../../chess/util/gamefileutility.js';
import game from './game.js';
import specialdetect from '../../chess/logic/specialdetect.js';
import guipromotion from '../gui/guipromotion.js';
import highlights from '../rendering/highlights.js';
import formatconverter from '../../chess/logic/formatconverter.js';
import perspective from '../rendering/perspective.js';
import transition from '../rendering/transition.js';
import board from '../rendering/board.js';
import pieces from '../rendering/pieces.js';
import movement from '../rendering/movement.js';
import moveutil from '../../chess/util/moveutil.js';
import options from '../rendering/options.js';
import statustext from '../gui/statustext.js';
import colorutil from '../../chess/util/colorutil.js';
import coordutil from '../../chess/util/coordutil.js';
import frametracker from '../rendering/frametracker.js';
import config from '../config.js';
import draganimation from '../rendering/draganimation.js';
import space from '../misc/space.js';
// Import End

/**
 * Type Definitions
 * @typedef {import('../../chess/util/moveutil.js').Move} Move
 * @typedef {import('../../chess/logic/legalmoves.js').LegalMoves} LegalMoves
 * @typedef {import('../../chess/logic/movepiece.js').Piece} Piece
 */

"use strict";

/**
 * This script tests for piece selection and keeps track of the selected piece,
 * including the legal moves it has available.
 */

/**
 * Bugs:
 * - Sound is played when selecting our pieces and after dragging an illeagal move.
 * - Opponent pieces can be selected by dragging.
 * To do:
 * - Fix above bugs.
 * - Move dragging logic from update into it's own methood.
 */

/** The currently selected piece, if there is one: `{ type, index, coords }` @type {Piece} */
let pieceSelected;
/** If true `pieceSelected` is currently being held. */
let draggingPiece = false;
/**
 * When dropped in the same square, pieces are unselected every second time.
 * This alows players to move pieces by clicking if they don't want to use drag.
 * @type{boolean} 
 * */
let didLastClickSelectPiece;
/** Set to false if the user want to use the original click controls. @type {boolean} */
let dragEnabled = true;
/** Is the user using touchscreen. If so we should ignor mouse over. @type {boolean} */
let touchscreenMode = false;
/** The pre-calculated legal moves of the current selected piece.
 * @type {LegalMoves} */
let legalMoves;
/** Whether or not the piece selected belongs to the opponent.
 * If so, it's legal moves are rendered a different color, and you aren't allowed to move it.  */
let isOpponentPiece = false;
/** Whether or not the piece selected activated premove mode.
 * This happens when we select our own pieces, in online games, when it's not our turn. */
let isPremove = false;

/** The tile the mouse is hovering over, OR the tile we just performed a simulated click over: `[x,y]` */
let hoverSquare; // Current square mouse is hovering over
/** Whether the {@link hoverSquare} is legal to move the selected piece to. */
let hoverSquareLegal = false;

/** If a pawn is currently promoting (waiting on the promotion UI selection),
 * this will be set to the square it's moving to: `[x,y]`, otherwise `false`. */
let pawnIsPromoting = false; // Set to coordsClicked when a player moves a pawn to the last rank
/** When a promotion UI piece is selected, this is set to the promotion you selected. */
let promoteTo;


/**
 * Returns the current selected piece, if there is one.
 * @returns {Piece | undefined} The selected piece, if there is one: `{ type, index, coords }`, otherwise undefined.
 */
function getPieceSelected() { return pieceSelected; }

function areDraggingPiece() { return draggingPiece; }

/**
 * Returns *true* if a piece is currently selected.
 * @returns {boolean}
 */
function isAPieceSelected() { return pieceSelected !== undefined; }

/**
 * Returns true if we have selected an opponents piece to view their moves
 * @returns {boolean}
 */
function isOpponentPieceSelected() { return isOpponentPiece; }

/**
 * Returns true if we are in premove mode (i.e. selected our own piece in an online game, when it's not our turn)
 * @returns {boolean}
 */
function arePremoving() { return isPremove; }

/**
 * Returns the pre-calculated legal moves of the selected piece.
 * @returns {LegalMoves}
 */
function getLegalMovesOfSelectedPiece() { return legalMoves; }

/**
 * Returns *true* if a pawn is currently promoting (promotion UI open).
 * @returns {boolean}
 */
function isPawnCurrentlyPromoting() { return pawnIsPromoting; }

/**
 * Flags the currently selected pawn to be promoted next frame.
 * Call when a choice is made on the promotion UI.
 * @param {boolean} type
 */
function promoteToType(type) { promoteTo = type; }

/** Tests if we have selected a piece, or moved the currently selected piece. */
function update() {
	// Guard clauses...
	const gamefile = game.getGamefile();
	// if (onlinegame.areInOnlineGame() && !onlinegame.isItOurTurn(gamefile)) return; // Not our turn
	if (input.isMouseDown_Right()) return unselectPiece(); // Right-click deselects everything
	if (pawnIsPromoting) { // Do nothing else this frame but wait for a promotion piece to be selected
		if (promoteTo) makePromotionMove();
		return;
	}
	if (perspective.isLookingUp() && draggingPiece) return draganimation.hideHeldPiece(); //Don't render the draggedPiece if we are looking at the sky.
	if (movement.isScaleLess1Pixel_Virtual() || transition.areWeTeleporting() || gamefile.gameConclusion || guipause.areWePaused() || perspective.isLookingUp()) return;

	// Calculate if the hover square is legal so we know if we need to render a ghost image...

	const touchHelds = input.getTouchHelds();
	if (touchHelds.length > 2) return; // The user is dragging or scaling. Don't select pieces.

	//pointer = touch, mouse, or other input device.
	const pointerHeld = input.isMouseHeld_Left() || touchHelds.length;
	const pointerDown = input.isMouseDown_Left() || input.atleast1TouchDown();
	
	/**
	 * On devices that support both mouse and touchscreen,
	 * the mouse location should not overwrite hoversquare unless it is in use.
	 * Otherwise when the user drops a piece it will go to the mouse location instead of where they last touched the screen.
	 * Some devices move the mouse with the touchscreen but not all.
	 */
	let tile;
	let pointerWorldLocation
	if (touchHelds.length) {
		tile = board.gtileCoordsOver(touchHelds[0].x, touchHelds[0].y);
		pointerWorldLocation = [space.convertPixelsToWorldSpace_Virtual(touchHelds[0].x), space.convertPixelsToWorldSpace_Virtual(touchHelds[0].y)];
		touchscreenMode = true;
	} else if (input.isMouseHeld_Left() || input.getMouseMoved()) {
		touchscreenMode = false;
	}
	if (!touchscreenMode) {
		tile = board.getTileMouseOver();
		pointerWorldLocation = input.getMouseWorldLocation();
	}
	//if tile === undefined,
	// we are using the touchscreen but it is not currently pressed
	// or we are in perspective mode, looking at the sky.
	if (tile || !touchscreenMode) hoverSquare = tile.tile_Int;
	
	//// What coordinates are we hovering over?
	
	updateHoverSquareLegal();
	
	const pieceClickedType = gamefileutility.getPieceTypeAtCoords(gamefile, hoverSquare);
	
	if (draggingPiece) {
		if (pointerHeld) { // still dragging.
			// Render the piece at the pointer.
			draganimation.dragPiece(pieceSelected.type, pieceSelected.coords, pointerWorldLocation, touchscreenMode);
		} else {
			handleMovingSelectedPiece(hoverSquare, pieceClickedType);
			draganimation.dropPiece(true, pieceClickedType);
			draggingPiece = false;
		}
	} else {
		if (!pointerDown) return; // Exit, we did not click
		
		if (pieceSelected) {
			handleMovingSelectedPiece(hoverSquare, pieceClickedType);
		} else {
			if (pieceClickedType) handleSelectingPiece(pieceClickedType);
		}
	}
	
	//if (!input.getMouseClicked() && !input.getTouchClicked()) return; // Exit, we did not click
	//
	//const pieceClickedType = gamefileutility.getPieceTypeAtCoords(gamefile, hoverSquare);
	//
	//if (pieceSelected) handleMovingSelectedPiece(hoverSquare, pieceClickedType); // A piece is already selected. Test if it was moved.
	//else if (pieceClickedType) handleSelectingPiece(pieceClickedType);
	//// Else we clicked, but there was no piece to select, *shrugs*
}

/** Picks up the currently selected piece if we are allowed to. */
function startDragging() {
	if (!dragEnabled || isOpponentPiece || (isPremove /*&& premovesEnabled*/) || movement.hasMomentum()) return false;
	return draggingPiece = true;
}

/**
 * A piece is already selected. This is called when you *click* somewhere.
 * This will execute the move if you clicked on a legal square to move to,
 * or it will select a different piece if you clicked another piece.
 * @param {number[]} coordsClicked - The square clicked: `[x,y]`.
 * @param {string} [pieceClickedType] - The type of piece clicked on, if there is one.
 */
function handleMovingSelectedPiece(coordsClicked, pieceClickedType) {
	const gamefile = game.getGamefile();

	tag: if (pieceClickedType) {

		// Did we click a friendly piece?
		// const selectedPieceColor = colorutil.getPieceColorFromType(pieceSelected.type)
		// const clickedPieceColor = colorutil.getPieceColorFromType(pieceClickedType);
		// if (selectedPieceColor !== clickedPieceColor) break tag; // Did not click a friendly

		if (hoverSquareLegal) break tag; // This piece is capturable, don't select it instead

		// If it clicked iteself, deselect or pick it up again.
		if (coordutil.areCoordsEqual(pieceSelected.coords, coordsClicked)) {
			if (draggingPiece) { //The piece was dropped in its original square.
				if (!didLastClickSelectPiece) unselectPiece();
			} else { //The selected piece was clicked.
				//Try to pick up the piece. If we can't (it's not our turn or belongs to our opponent), unselect it. 
				if (!startDragging()) unselectPiece();
				didLastClickSelectPiece = false;
			}
		} else if (pieceClickedType !== 'voidsN' && !draggingPiece) { // Select that other piece instead. Prevents us from selecting a void after selecting an obstacle.
			handleSelectingPiece(pieceClickedType);
		}

		return;
	}

	// If we haven't return'ed at this point, check if the move is legal.
	if (!hoverSquareLegal) return; // Illegal

	// If it's a premove, hoverSquareLegal should not be true at this point unless
	// we are actually starting to implement premoving.
	if (isPremove) throw new Error("Don't know how to premove yet! Will not submit move normally.");

	// Don't move the piece if the mesh is locked, because it will mess up the mesh generation algorithm.
	if (gamefile.mesh.locked) return statustext.pleaseWaitForTask(); 

	// Check if the move is a pawn promotion
	if (specialdetect.isPawnPromotion(gamefile, pieceSelected.type, coordsClicked)) {
		const color = colorutil.getPieceColorFromType(pieceSelected.type);
		guipromotion.open(color);
		pawnIsPromoting = coordsClicked;
		return;
	}

	moveGamefilePiece(coordsClicked);
}

/**
 * A piece is **not** already selected. This is called when you *click* a piece.
 * This will select the piece if it is a friendly, or forward
 * you to the game's front if your viewing past moves.
 * @param {number[]} coordsClicked - The square clicked: `[x,y]`.
 * @param {string} [pieceClickedType] - The type of piece clicked on, if there is one.
 */
function handleSelectingPiece(pieceClickedType) {
	const gamefile = game.getGamefile();

	// If we're viewing history, return. But also if we clicked a piece, forward moves.
	if (!moveutil.areWeViewingLatestMove(gamefile)) {
		// if (clickedPieceColor === gamefile.whosTurn ||
		//     options.getEM() && pieceClickedType !== 'voidsN') 
		// ^^ The extra conditions needed here so in edit mode and you click on an opponent piece
		// it will still forward you to front!
        
		return movepiece.forwardToFront(gamefile, { flipTurn: false, updateProperties: false });
	}

	// If it's your turn, select that piece.

	// if (clickedPieceColor !== gamefile.whosTurn && !options.getEM()) return; // Don't select opposite color
	if (hoverSquareLegal) return; // Don't select different piece if the move is legal (its a capture)
	const clickedPieceColor = colorutil.getPieceColorFromType(pieceClickedType);
	if (!options.getEM() && clickedPieceColor === colorutil.colorOfNeutrals) return; // Don't select neutrals, unless we're in edit mode
	if (pieceClickedType === 'voidsN') return; // NEVER select voids, EVEN in edit mode.

	const clickedPieceIndex = gamefileutility.getPieceIndexByTypeAndCoords(gamefile, pieceClickedType, hoverSquare);

	// Select the piece
	selectPiece(pieceClickedType, clickedPieceIndex, hoverSquare);
}

/**
 * Selects the provided piece. Auto-calculates it's legal moves.
 * @param {string} type - The type of piece to select.
 * @param {*} index - The index of the piece within the gamefile's piece list.
 * @param {*} coords - The coordinates of the piece.
 */
function selectPiece(type, index, coords) {
	frametracker.onVisualChange();
	pieceSelected = { type, index, coords };
	// Calculate the legal moves it has. Keep a record of this so that when the mouse clicks we can easily test if that is a valid square.
	legalMoves = legalmoves.calculate(game.getGamefile(), pieceSelected);

	const pieceColor = colorutil.getPieceColorFromType(pieceSelected.type);
	isOpponentPiece = onlinegame.areInOnlineGame() ? pieceColor !== onlinegame.getOurColor()
    /* Local Game */ : pieceColor !== game.getGamefile().whosTurn;
	isPremove = !isOpponentPiece && onlinegame.areInOnlineGame() && !onlinegame.isItOurTurn();

	highlights.regenModel(); // Generate the buffer model for the blue legal move fields.
	startDragging();
	didLastClickSelectPiece = true;
}

/**
 * Reselects the currently selected piece by recalculating its legal moves again,
 * and changing the color if needed.
 * Typically called after our opponent makes a move while we have a piece selected.
 */
function reselectPiece() {
	if (!pieceSelected) return; // No piece to reselect.
	const gamefile = game.getGamefile();
	// Test if the piece is no longer there
	// This will work for us long as it is impossible to capture friendly's
	const pieceTypeOnCoords = gamefileutility.getPieceTypeAtCoords(gamefile, pieceSelected.coords);
	if (pieceTypeOnCoords !== pieceSelected.type) { // It either moved, or was captured
		unselectPiece(); // Can't be reselected, unselect it instead.
		return;
	}

	if (game.getGamefile().gameConclusion) return; // Don't reselect, game is over

	// Reselect! Recalc its legal moves, and recolor.
	const newIndex = gamefileutility.getPieceIndexByTypeAndCoords(gamefile, pieceSelected.type, pieceSelected.coords);
	selectPiece(pieceSelected.type, newIndex, pieceSelected.coords);
}

/**
 * Unselects the currently selected piece. Cancels pawns currently promoting, closes the promotion UI.
 */
function unselectPiece() {
	pieceSelected = undefined;
	draggingPiece = false;
	isOpponentPiece = false;
	isPremove = false;
	legalMoves = undefined;
	pawnIsPromoting = false;
	promoteTo = undefined;
	guipromotion.close(); // Close the promotion UI
	frametracker.onVisualChange();
}

/**
 * Moves the currently selected piece to the specified coordinates, then unselects the piece.
 * The destination coordinates MUST contain any special move flags.
 * @param {number[]} coords - The destination coordinates`[x,y]`. MUST contain any special move flags.
 */
function moveGamefilePiece(coords) {
	const strippedCoords = movepiece.stripSpecialMoveTagsFromCoords(coords);
	/** @type {Move} */
	const move = { type: pieceSelected.type, startCoords: pieceSelected.coords, endCoords: strippedCoords };
	specialdetect.transferSpecialFlags_FromCoordsToMove(coords, move);
	const compact = formatconverter.LongToShort_CompactMove(move);
	move.compact = compact;

	movepiece.makeMove(game.getGamefile(), move, {animate: !draggingPiece, animateSecondary: draggingPiece});
	onlinegame.sendMove();

	unselectPiece();
}

/** Adds the promotion flag to the destination coordinates before making the move. */
function makePromotionMove() {
	const coords = pawnIsPromoting;
	coords.promotion = promoteTo; // Add a tag on the coords of what piece we're promoting to
	moveGamefilePiece(coords);
	perspective.relockMouse();
}

/**
 * Tests if the square being hovered over is among
 * our pre-calculated legal moves for our selected piece.
 * Updates the {@link hoverSquareLegal} variable.
 */
function updateHoverSquareLegal() {
	if (!pieceSelected) {
		hoverSquareLegal = false;
		return;
	}

	const gamefile = game.getGamefile();
	const typeAtHoverCoords = gamefileutility.getPieceTypeAtCoords(gamefile, hoverSquare);
	const hoverSquareIsSameColor = typeAtHoverCoords && colorutil.getPieceColorFromType(pieceSelected.type) === colorutil.getPieceColorFromType(typeAtHoverCoords);
	const hoverSquareIsVoid = !hoverSquareIsSameColor && typeAtHoverCoords === 'voidsN';
	// The next boolean ensures that only pieces of the same color as the current player's turn can have a ghost piece:
	const selectionColorAgreesWithMoveTurn = colorutil.getPieceColorFromType(pieceSelected.type) === gamefile.whosTurn;
	// This will also subtley transfer any en passant capture tags to our `hoverSquare` if the function found an individual move with the tag.
	hoverSquareLegal = (selectionColorAgreesWithMoveTurn && !isOpponentPiece && legalmoves.checkIfMoveLegal(legalMoves, pieceSelected.coords, hoverSquare)) || (options.getEM() && !hoverSquareIsVoid && !hoverSquareIsSameColor);
}

/** Renders the translucent piece underneath your mouse when hovering over the blue legal move fields. */
function renderGhostPiece() {
	if (!isAPieceSelected() || !hoverSquare || !hoverSquareLegal || draggingPiece || !input.isMouseSupported() || config.VIDEO_MODE) return;
	pieces.renderGhostPiece(pieceSelected.type, hoverSquare);
}

export default {
	isAPieceSelected,
	getPieceSelected,
	reselectPiece,
	unselectPiece,
	getLegalMovesOfSelectedPiece,
	isPawnCurrentlyPromoting,
	promoteToType,
	update,
	renderGhostPiece,
	isOpponentPieceSelected,
	arePremoving,
	areDraggingPiece
};